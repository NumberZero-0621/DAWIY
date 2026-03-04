use std::ffi::{c_void, c_char};
use std::io::Write;
use std::sync::atomic::{AtomicI32, Ordering};
use std::sync::mpsc::{channel, Sender, Receiver};
use std::thread;
use std::collections::HashMap;
use std::sync::Mutex;
use once_cell::sync::Lazy;

// Track loaded libraries to prevent double-init/exit (Voisona Fix)
// Map<HMODULE as isize, ref_count>
static LOADED_LIBRARIES: Lazy<Mutex<HashMap<isize, usize>>> = Lazy::new(|| {
    Mutex::new(HashMap::new())
});

use vst3_sys::base::{kResultOk, IPluginFactory, kNoInterface, IPluginBase, IUnknown, tresult, TBool, kNotImplemented, kInvalidArgument};
use vst3_sys::vst::{
    IComponent, IEditController, IHostApplication, IComponentHandler, ParamID, ParamValue
};
use vst3_sys::gui::{IPlugView, ViewRect, IPlugFrame}; 

use vst3_com::{IID, VstPtr, ComInterface};
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM, RECT};
use windows::Win32::System::LibraryLoader::{GetModuleHandleW, LoadLibraryW, GetProcAddress};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, LoadCursorW,
    RegisterClassW, CS_HREDRAW, CS_VREDRAW,
    CW_USEDEFAULT, IDC_ARROW, MSG, WINDOW_EX_STYLE,
    WM_DESTROY, WM_SIZE, WM_CLOSE, WNDCLASSW, WS_OVERLAPPEDWINDOW,
    AdjustWindowRect, SetWindowLongPtrW, GetWindowLongPtrW, GWLP_USERDATA,
    SetWindowPos, SWP_NOMOVE, SWP_NOZORDER, SWP_NOACTIVATE, SW_SHOW, SetTimer, ShowWindow, DestroyWindow, SetWindowTextW
};
use windows::Win32::Graphics::Gdi::{GetStockObject, BLACK_BRUSH, HBRUSH};
use windows::Win32::System::Ole::{OleInitialize, OleUninitialize};
use windows::core::{PCWSTR, s, w};

// --- Interfaces Implementation ---

// --- Unified Host Implementation ---

enum VstCommand {
    Load(String, f32, Sender<Result<u32, String>>), // returns Instance ID
    Midi(u32, u8, u8, u8), // instance_id, status, data1, data2
    GetAudio(u32, usize, Sender<Result<(Vec<f32>, Vec<f32>), String>>), // instance_id, req_samples, response
    ProcessAudio(u32, usize, Vec<f32>, Vec<f32>, Sender<Result<(Vec<f32>, Vec<f32>), String>>), // instance_id, req_samples, in_l, in_r, response
    Close(u32), // instance_id
    Show(u32), // instance_id
}

struct VstInstance {
    id: u32,
    hwnd: HWND,
    lib_handle: windows::Win32::Foundation::HMODULE,
    factory: Option<VstPtr<dyn IPluginFactory>>,
    pub component: Option<VstPtr<dyn IComponent>>,
    pub edit_controller: Option<VstPtr<dyn IEditController>>,
    pub view: Option<VstPtr<dyn IPlugView>>,
    pub path: String,
    pub midi_events: std::collections::VecDeque<(u8, u8, u8)>,
    sample_rate: f64,
    continuous_time_samples: i64,
}

struct VstCoordinator {
    tx: Sender<VstCommand>,
}

static COORDINATOR: Mutex<Option<VstCoordinator>> = Mutex::new(None);
static NEXT_INSTANCE_ID: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(1);

// --- Definitions Missing from Cleanup ---
#[repr(C)]
struct IHostApplicationVTableLayout {
    pub query_interface: unsafe extern "system" fn(*mut c_void, *const IID, *mut *mut c_void) -> i32,
    pub add_ref: unsafe extern "system" fn(*mut c_void) -> u32,
    pub release: unsafe extern "system" fn(*mut c_void) -> u32,
    pub get_name: unsafe extern "system" fn(*mut c_void, *mut u16) -> i32,
    pub create_instance: unsafe extern "system" fn(*mut c_void, *const IID, *const IID, *mut *mut c_void) -> i32,
}

#[repr(C)]
struct IComponentHandlerVTableLayout {
    pub query_interface: unsafe extern "system" fn(*mut c_void, *const IID, *mut *mut c_void) -> i32,
    pub add_ref: unsafe extern "system" fn(*mut c_void) -> u32,
    pub release: unsafe extern "system" fn(*mut c_void) -> u32,
    pub begin_edit: unsafe extern "system" fn(*mut c_void, ParamID) -> tresult,
    pub perform_edit: unsafe extern "system" fn(*mut c_void, ParamID, ParamValue) -> tresult,
    pub end_edit: unsafe extern "system" fn(*mut c_void, ParamID) -> tresult,
    pub restart_component: unsafe extern "system" fn(*mut c_void, i32) -> tresult,
}

#[repr(C)]
struct IComponentHandler2VTableLayout {
    pub query_interface: unsafe extern "system" fn(this: *mut c_void, iid: *const IID, obj: *mut *mut c_void) -> tresult,
    pub add_ref: unsafe extern "system" fn(this: *mut c_void) -> u32,
    pub release: unsafe extern "system" fn(this: *mut c_void) -> u32,
    pub begin_edit: unsafe extern "system" fn(this: *mut c_void, id: ParamID) -> tresult,
    pub perform_edit: unsafe extern "system" fn(this: *mut c_void, id: ParamID, value_normalized: ParamValue) -> tresult,
    pub end_edit: unsafe extern "system" fn(this: *mut c_void, id: ParamID) -> tresult,
    pub restart_component: unsafe extern "system" fn(this: *mut c_void, flags: i32) -> tresult,
    pub set_dirty: unsafe extern "system" fn(this: *mut c_void, state: TBool) -> tresult,
    pub request_open_editor: unsafe extern "system" fn(this: *mut c_void, name: *const c_char) -> tresult,
    pub start_group_edit: unsafe extern "system" fn(this: *mut c_void) -> tresult,
    pub finish_group_edit: unsafe extern "system" fn(this: *mut c_void) -> tresult,
}

#[repr(C)]
struct IComponentHandler3VTableLayout {
    pub query_interface: unsafe extern "system" fn(this: *mut c_void, iid: *const IID, obj: *mut *mut c_void) -> tresult,
    pub add_ref: unsafe extern "system" fn(this: *mut c_void) -> u32,
    pub release: unsafe extern "system" fn(this: *mut c_void) -> u32,
    pub begin_edit: unsafe extern "system" fn(this: *mut c_void, id: ParamID) -> tresult,
    pub perform_edit: unsafe extern "system" fn(this: *mut c_void, id: ParamID, value_normalized: ParamValue) -> tresult,
    pub end_edit: unsafe extern "system" fn(this: *mut c_void, id: ParamID) -> tresult,
    pub restart_component: unsafe extern "system" fn(this: *mut c_void, flags: i32) -> tresult,
    pub set_dirty: unsafe extern "system" fn(this: *mut c_void, state: TBool) -> tresult,
    pub request_open_editor: unsafe extern "system" fn(this: *mut c_void, name: *const c_char) -> tresult,
    pub start_group_edit: unsafe extern "system" fn(this: *mut c_void) -> tresult,
    pub finish_group_edit: unsafe extern "system" fn(this: *mut c_void) -> tresult,
    pub create_context_menu: unsafe extern "system" fn(this: *mut c_void, plug_view: *mut c_void, flags: *const i32) -> *mut c_void, // returns IContextMenu*
}

// 0xF1CB B827 43A4 9267 6408 3193 358F 2C75
const IID_ICOMPONENTHANDLER2: IID = IID {
    data: [0x27, 0xB8, 0xCB, 0xF1, 0xA4, 0x43, 0x67, 0x92, 0x64, 0x08, 0x31, 0x93, 0x35, 0x8F, 0x2C, 0x75],
};

// 0xF040B4B3 A36045EC ABCDC045 B4D5A2CC
const IID_ICOMPONENTHANDLER3: IID = IID {
    data: [0xB3, 0xB4, 0x40, 0xF0, 0x60, 0xA3, 0xEC, 0x45, 0xAB, 0xCD, 0xC0, 0x45, 0xB4, 0xD5, 0xA2, 0xCC],
};

// 936F033B-C6C0-47DB-BB08-82F813C1E613
const IID_IMESSAGE: IID = IID {
    data: [0x3B, 0x03, 0x6F, 0x93, 0xC0, 0xC6, 0xDB, 0x47, 0xBB, 0x08, 0x82, 0xF8, 0x13, 0xC1, 0xE6, 0x13],
};

// B7130D8F-B91F-470F-99F5-341C61F3430E
const IID_IATTRIBUTELIST: IID = IID {
    data: [0x8F, 0x0D, 0x13, 0xB7, 0x1F, 0xB9, 0x0F, 0x47, 0x99, 0xF5, 0x34, 0x1C, 0x61, 0xF3, 0x43, 0x0E],
};

// --- IAttributeList Implementation ---
#[repr(C)]
struct IAttributeListVTableLayout {
    pub query_interface: unsafe extern "system" fn(this: *mut c_void, iid: *const IID, obj: *mut *mut c_void) -> tresult,
    pub add_ref: unsafe extern "system" fn(this: *mut c_void) -> u32,
    pub release: unsafe extern "system" fn(this: *mut c_void) -> u32,
    pub set_int: unsafe extern "system" fn(this: *mut c_void, id: *const c_char, value: i64) -> tresult,
    pub get_int: unsafe extern "system" fn(this: *mut c_void, id: *const c_char, value: *mut i64) -> tresult,
    pub set_float: unsafe extern "system" fn(this: *mut c_void, id: *const c_char, value: f64) -> tresult,
    pub get_float: unsafe extern "system" fn(this: *mut c_void, id: *const c_char, value: *mut f64) -> tresult,
    pub set_string: unsafe extern "system" fn(this: *mut c_void, id: *const c_char, value: *const u16) -> tresult,
    pub get_string: unsafe extern "system" fn(this: *mut c_void, id: *const c_char, value: *mut u16, size: i32) -> tresult,
    pub set_binary: unsafe extern "system" fn(this: *mut c_void, id: *const c_char, data: *const c_void, size: u32) -> tresult,
    pub get_binary: unsafe extern "system" fn(this: *mut c_void, id: *const c_char, data: *mut *const c_void, size: *mut u32) -> tresult,
}

#[repr(C)]
struct HostAttributeList {
    pub vptr: *const IAttributeListVTableLayout,
    ref_count: AtomicI32,
    // Use Mutex for thread safety
    int_map: Mutex<std::collections::HashMap<String, i64>>,
    float_map: Mutex<std::collections::HashMap<String, f64>>,
    string_map: Mutex<std::collections::HashMap<String, Vec<u16>>>,
    binary_map: Mutex<std::collections::HashMap<String, Vec<u8>>>,
}

unsafe extern "system" fn attr_list_query_interface(this: *mut c_void, iid: *const IID, obj: *mut *mut c_void) -> tresult {
    let check = *iid;
    if check == <dyn IUnknown as ComInterface>::IID || check == IID_IATTRIBUTELIST {
        *obj = this;
        attr_list_add_ref(this);
        return kResultOk;
    }
    kNoInterface
}
unsafe extern "system" fn attr_list_add_ref(this: *mut c_void) -> u32 {
    let s = &*(this as *const HostAttributeList);
    s.ref_count.fetch_add(1, Ordering::Relaxed) as u32 + 1
}
unsafe extern "system" fn attr_list_release(this: *mut c_void) -> u32 {
    let s = &*(this as *const HostAttributeList);
    let val = s.ref_count.fetch_sub(1, Ordering::Relaxed);
    if val == 1 {
        let _ = Box::from_raw(this as *mut HostAttributeList);
    }
    val as u32 - 1
}

unsafe extern "system" fn attr_list_set_int(this: *mut c_void, id: *const c_char, value: i64) -> tresult {
    let s = &*(this as *const HostAttributeList);
    let key = std::ffi::CStr::from_ptr(id).to_string_lossy().into_owned();
    s.int_map.lock().unwrap().insert(key, value);
    kResultOk
}
unsafe extern "system" fn attr_list_get_int(this: *mut c_void, id: *const c_char, value: *mut i64) -> tresult {
    let s = &*(this as *const HostAttributeList);
    let key = std::ffi::CStr::from_ptr(id).to_string_lossy();
    if let Some(&v) = s.int_map.lock().unwrap().get(key.as_ref()) {
        *value = v;
        return kResultOk;
    }
    *value = 0; // Zero out
    kResultOk
}

unsafe extern "system" fn attr_list_set_float(this: *mut c_void, id: *const c_char, value: f64) -> tresult {
    let s = &*(this as *const HostAttributeList);
    let key = std::ffi::CStr::from_ptr(id).to_string_lossy().into_owned();
    s.float_map.lock().unwrap().insert(key, value);
    kResultOk
}
unsafe extern "system" fn attr_list_get_float(this: *mut c_void, id: *const c_char, value: *mut f64) -> tresult {
    let s = &*(this as *const HostAttributeList);
    let key = std::ffi::CStr::from_ptr(id).to_string_lossy();
    if let Some(&v) = s.float_map.lock().unwrap().get(key.as_ref()) {
        *value = v;
        return kResultOk;
    }
    *value = 0.0;
    kResultOk
}

unsafe extern "system" fn attr_list_set_string(this: *mut c_void, id: *const c_char, value: *const u16) -> tresult {
    if id.is_null() || value.is_null() { return kInvalidArgument; }
    let s = &*(this as *const HostAttributeList);
    let key = std::ffi::CStr::from_ptr(id).to_string_lossy().into_owned();
    
    // Copy u16 string with safety limit
    let mut vec_u16 = Vec::with_capacity(64);
    let mut ptr = value;
    for _ in 0..8192 { // Limit to 8KB string to prevent infinite read
        let c = *ptr;
        if c == 0 { break; }
        vec_u16.push(c);
        ptr = ptr.add(1);
    }
    
    s.string_map.lock().unwrap().insert(key, vec_u16);
    kResultOk
}
unsafe extern "system" fn attr_list_get_string(this: *mut c_void, id: *const c_char, value: *mut u16, size: i32) -> tresult {
     if id.is_null() { return kInvalidArgument; }
     let s = &*(this as *const HostAttributeList);
     let key = std::ffi::CStr::from_ptr(id).to_string_lossy();
     if let Some(v) = s.string_map.lock().unwrap().get(key.as_ref()) {
         let len = std::cmp::min(v.len(), (size - 1) as usize);
         std::ptr::copy_nonoverlapping(v.as_ptr(), value, len);
         *value.add(len) = 0;
         return kResultOk;
     } 
     *value = 0;
     kResultOk
}

unsafe extern "system" fn attr_list_set_binary(this: *mut c_void, id: *const c_char, data: *const c_void, size: u32) -> tresult {
    if id.is_null() || data.is_null() { return kInvalidArgument; }
    let s = &*(this as *const HostAttributeList);
    let key = std::ffi::CStr::from_ptr(id).to_string_lossy().into_owned();
    let slice = std::slice::from_raw_parts(data as *const u8, size as usize);
    s.binary_map.lock().unwrap().insert(key, slice.to_vec());
    kResultOk
}

unsafe extern "system" fn attr_list_get_binary(this: *mut c_void, id: *const c_char, data: *mut *const c_void, size: *mut u32) -> tresult {
    if id.is_null() { return kInvalidArgument; }
    
    let s = &*(this as *const HostAttributeList);
    let key = std::ffi::CStr::from_ptr(id).to_string_lossy();
    
    if let Some(v) = s.binary_map.lock().unwrap().get(key.as_ref()) {
         if !data.is_null() { 
             *data = v.as_ptr() as *const c_void; 
         }
         if !size.is_null() { 
             *size = v.len() as u32; 
         }
         return kResultOk;
    }

    if !data.is_null() { *data = std::ptr::null(); }
    if !size.is_null() { *size = 0; }
    
    kNotImplemented
}


static ATTR_LIST_VTBL: IAttributeListVTableLayout = IAttributeListVTableLayout {
    query_interface: attr_list_query_interface,
    add_ref: attr_list_add_ref,
    release: attr_list_release,
    set_int: attr_list_set_int,
    get_int: attr_list_get_int,
    set_float: attr_list_set_float,
    get_float: attr_list_get_float,
    set_string: attr_list_set_string,
    get_string: attr_list_get_string,
    set_binary: attr_list_set_binary,
    get_binary: attr_list_get_binary,
};

fn create_attribute_list() -> *mut c_void {
    let list = Box::new(HostAttributeList {
        vptr: &ATTR_LIST_VTBL,
        ref_count: AtomicI32::new(1),
        int_map: Mutex::new(std::collections::HashMap::new()),
        float_map: Mutex::new(std::collections::HashMap::new()),
        string_map: Mutex::new(std::collections::HashMap::new()),
        binary_map: Mutex::new(std::collections::HashMap::new()),
    });
    Box::into_raw(list) as *mut c_void
}


// --- IMessage Implementation ---
#[repr(C)]
struct IMessageVTableLayout {
    pub query_interface: unsafe extern "system" fn(this: *mut c_void, iid: *const IID, obj: *mut *mut c_void) -> tresult,
    pub add_ref: unsafe extern "system" fn(this: *mut c_void) -> u32,
    pub release: unsafe extern "system" fn(this: *mut c_void) -> u32,
    pub get_message_id: unsafe extern "system" fn(this: *mut c_void) -> *const c_char,
    pub set_message_id: unsafe extern "system" fn(this: *mut c_void, id: *const c_char) -> tresult,
    pub get_attributes: unsafe extern "system" fn(this: *mut c_void) -> *mut c_void, // Returns IAttributeList*
}

#[repr(C)]
struct HostMessage {
    pub vptr: *const IMessageVTableLayout,
    ref_count: AtomicI32,
    message_id: Mutex<String>, 
    attributes: *mut c_void, // IAttributeList*
}

unsafe extern "system" fn message_query_interface(this: *mut c_void, iid: *const IID, obj: *mut *mut c_void) -> tresult {
    let check = *iid;
    if check == <dyn IUnknown as ComInterface>::IID || check == IID_IMESSAGE {
        *obj = this;
        message_add_ref(this);
        return kResultOk;
    }
    kNoInterface
}
unsafe extern "system" fn message_add_ref(this: *mut c_void) -> u32 {
    let s = &*(this as *const HostMessage);
    s.ref_count.fetch_add(1, Ordering::Relaxed) as u32 + 1
}
unsafe extern "system" fn message_release(this: *mut c_void) -> u32 {
    let s = &*(this as *const HostMessage);
    let val = s.ref_count.fetch_sub(1, Ordering::Relaxed);
    if val == 1 {
        // Release attributes
        if !s.attributes.is_null() {
             let attr = s.attributes as *mut *const IAttributeListVTableLayout;
             let vptr = &**attr;
             (vptr.release)(s.attributes);
        }
        let _ = Box::from_raw(this as *mut HostMessage);
    }
    val as u32 - 1
}

unsafe extern "system" fn message_get_message_id(this: *mut c_void) -> *const c_char {
    let s = &*(this as *const HostMessage);
    // Use lock
    let str_ref = s.message_id.lock().unwrap();
    str_ref.as_ptr() as *const c_char
}

unsafe extern "system" fn message_set_message_id(this: *mut c_void, id: *const c_char) -> tresult {
    let s = &*(this as *const HostMessage);
    let c_str = std::ffi::CStr::from_ptr(id);
    *s.message_id.lock().unwrap() = format!("{}\0", c_str.to_string_lossy());
    kResultOk
}

unsafe extern "system" fn message_get_attributes(this: *mut c_void) -> *mut c_void {
    let s = &*(this as *const HostMessage);
    if !s.attributes.is_null() {
        let attr = s.attributes as *mut *const IAttributeListVTableLayout;
        let vptr = &**attr;
        (vptr.add_ref)(s.attributes);
        return s.attributes;
    }
    std::ptr::null_mut()
}

static MESSAGE_VTBL: IMessageVTableLayout = IMessageVTableLayout {
    query_interface: message_query_interface,
    add_ref: message_add_ref,
    release: message_release,
    get_message_id: message_get_message_id,
    set_message_id: message_set_message_id,
    get_attributes: message_get_attributes,
};

fn create_host_message() -> *mut c_void {
    let attr_list = create_attribute_list();
    let msg = Box::new(HostMessage {
        vptr: &MESSAGE_VTBL,
        ref_count: AtomicI32::new(1),
        message_id: Mutex::new(String::from("NewMessage\0")),
        attributes: attr_list,
    });
    Box::into_raw(msg) as *mut c_void
}

// ----------------------------------------
// --- IEventList Implementation ---
// ----------------------------------------
use vst3_sys::vst::{IEventList, Event};

#[repr(C)]
struct IEventListVTableLayout {
    pub query_interface: unsafe extern "system" fn(this: *mut c_void, iid: *const IID, obj: *mut *mut c_void) -> tresult,
    pub add_ref: unsafe extern "system" fn(this: *mut c_void) -> u32,
    pub release: unsafe extern "system" fn(this: *mut c_void) -> u32,
    pub get_event_count: unsafe extern "system" fn(this: *mut c_void) -> i32,
    pub get_event: unsafe extern "system" fn(this: *mut c_void, index: i32, event: *mut Event) -> tresult,
    pub add_event: unsafe extern "system" fn(this: *mut c_void, event: *mut Event) -> tresult,
}

#[repr(C)]
struct HostEventList {
    pub vptr: *const IEventListVTableLayout,
    ref_count: AtomicI32,
    events: Mutex<Vec<Event>>,
}

unsafe extern "system" fn eventlist_query_interface(this: *mut c_void, iid: *const IID, obj: *mut *mut c_void) -> tresult {
    let check = *iid;
    if check == <dyn IUnknown as ComInterface>::IID || check == <dyn IEventList as ComInterface>::IID {
        *obj = this;
        eventlist_add_ref(this);
        return kResultOk;
    }
    kNoInterface
}

unsafe extern "system" fn eventlist_add_ref(this: *mut c_void) -> u32 {
    let s = &*(this as *const HostEventList);
    s.ref_count.fetch_add(1, Ordering::Relaxed) as u32 + 1
}

unsafe extern "system" fn eventlist_release(this: *mut c_void) -> u32 {
    let s = &*(this as *const HostEventList);
    let val = s.ref_count.fetch_sub(1, Ordering::Relaxed);
    if val == 1 {
        let _ = Box::from_raw(this as *mut HostEventList);
    }
    val as u32 - 1
}

unsafe extern "system" fn eventlist_get_event_count(this: *mut c_void) -> i32 {
    let s = &*(this as *const HostEventList);
    s.events.lock().unwrap().len() as i32
}

unsafe extern "system" fn eventlist_get_event(this: *mut c_void, index: i32, event: *mut Event) -> tresult {
    if event.is_null() { return kInvalidArgument; }
    let s = &*(this as *const HostEventList);
    let events = s.events.lock().unwrap();
    if index >= 0 && (index as usize) < events.len() {
        *event = events[index as usize];
        return kResultOk;
    }
    kInvalidArgument
}

unsafe extern "system" fn eventlist_add_event(this: *mut c_void, event: *mut Event) -> tresult {
    if event.is_null() { return kInvalidArgument; }
    let s = &*(this as *const HostEventList);
    s.events.lock().unwrap().push(*event);
    kResultOk
}

static EVENTLIST_VTBL: IEventListVTableLayout = IEventListVTableLayout {
    query_interface: eventlist_query_interface,
    add_ref: eventlist_add_ref,
    release: eventlist_release,
    get_event_count: eventlist_get_event_count,
    get_event: eventlist_get_event,
    add_event: eventlist_add_event,
};

fn create_host_event_list() -> *mut HostEventList {
    let list = Box::new(HostEventList {
        vptr: &EVENTLIST_VTBL,
        ref_count: AtomicI32::new(1),
        events: Mutex::new(Vec::new()),
    });
    Box::into_raw(list)
}

// ----------------------------------------

#[repr(C)]
struct UnifiedHost {
    pub vptr_host: *const IHostApplicationVTableLayout,
    pub vptr_handler1: *const IComponentHandlerVTableLayout,
    pub vptr_handler2: *const IComponentHandler2VTableLayout,
    pub vptr_handler3: *const IComponentHandler3VTableLayout,
    ref_count: AtomicI32,
}

// Implementation of ComponentHandler
unsafe extern "system" fn ComponentHandler_begin_edit(_this: *mut c_void, id: u32) -> i32 {
    println!("[Native] ComponentHandler::begin_edit id={}", id);
    kResultOk
}
unsafe extern "system" fn ComponentHandler_perform_edit(_this: *mut c_void, _id: u32, _value: f64) -> i32 {
    // println!("[Native] ComponentHandler::perform_edit id={} val={}", id, value);
    kResultOk
}
unsafe extern "system" fn ComponentHandler_end_edit(_this: *mut c_void, id: u32) -> i32 {
    println!("[Native] ComponentHandler::end_edit id={}", id);
    kResultOk
}
unsafe extern "system" fn ComponentHandler_restart_component(_this: *mut c_void, flags: i32) -> i32 {
    println!("[Native] ComponentHandler::restart_component flags={}", flags);
    kResultOk
}
unsafe extern "system" fn ComponentHandler_set_dirty(_this: *mut c_void, state: u8) -> i32 {
    println!("[Native] ComponentHandler::set_dirty state={}", state);
    kResultOk
}
unsafe extern "system" fn ComponentHandler_request_open_editor(_this: *mut c_void, name: *const c_char) -> i32 {
    println!("[Native] ComponentHandler::request_open_editor name={:?}", name);
    kResultOk
}
unsafe extern "system" fn ComponentHandler_start_group_edit(_this: *mut c_void, /*id: u32*/ ) -> i32 {
    println!("[Native] ComponentHandler::start_group_edit (No ID in vst3-sys)");
    kResultOk
}
unsafe extern "system" fn ComponentHandler_finish_group_edit(_this: *mut c_void, /*id: u32*/ ) -> i32 {
    println!("[Native] ComponentHandler::finish_group_edit (No ID in vst3-sys)");
    kResultOk
}
unsafe extern "system" fn ComponentHandler_create_context_menu(_this: *mut c_void, _plug_view: *mut c_void, _flags: *const i32) -> *mut c_void {
    println!("[Native] ComponentHandler::create_context_menu called. Not Implemented.");
    use std::io::Write;
    let _ = std::io::stdout().flush();
    std::ptr::null_mut()
} // Renamed to match static struct use (ComponentHandler3_...)

static HOST_VTBL: IHostApplicationVTableLayout = IHostApplicationVTableLayout {
    query_interface: UnifiedHost_query_interface,
    add_ref: UnifiedHost_add_ref,
    release: UnifiedHost_release,
    get_name: HostApplication_get_name,
    create_instance: HostApplication_create_instance,
};

static HANDLER1_VTBL: IComponentHandlerVTableLayout = IComponentHandlerVTableLayout {
    query_interface: UnifiedHandler_query_interface1,
    add_ref: UnifiedHandler_add_ref1,
    release: UnifiedHandler_release1,
    begin_edit: ComponentHandler_begin_edit,
    perform_edit: ComponentHandler_perform_edit,
    end_edit: ComponentHandler_end_edit,
    restart_component: ComponentHandler_restart_component,
};

static HANDLER2_VTBL: IComponentHandler2VTableLayout = IComponentHandler2VTableLayout {
    query_interface: UnifiedHandler_query_interface2,
    add_ref: UnifiedHandler_add_ref2,
    release: UnifiedHandler_release2,
    begin_edit: ComponentHandler_begin_edit,
    perform_edit: ComponentHandler_perform_edit,
    end_edit: ComponentHandler_end_edit,
    restart_component: ComponentHandler_restart_component,
    set_dirty: ComponentHandler_set_dirty,
    request_open_editor: ComponentHandler_request_open_editor,
    start_group_edit: ComponentHandler_start_group_edit,
    finish_group_edit: ComponentHandler_finish_group_edit,
};

static HANDLER3_VTBL: IComponentHandler3VTableLayout = IComponentHandler3VTableLayout {
    query_interface: UnifiedHandler_query_interface3, 
    add_ref: UnifiedHandler_add_ref3,
    release: UnifiedHandler_release3,
    begin_edit: ComponentHandler_begin_edit,
    perform_edit: ComponentHandler_perform_edit,
    end_edit: ComponentHandler_end_edit,
    restart_component: ComponentHandler_restart_component,
    set_dirty: ComponentHandler_set_dirty,
    request_open_editor: ComponentHandler_request_open_editor,
    start_group_edit: ComponentHandler_start_group_edit,
    finish_group_edit: ComponentHandler_finish_group_edit,
    create_context_menu: ComponentHandler_create_context_menu,
};

// Helper: Get UnifiedHost from vptr_host (offset 0)
unsafe fn host_from_vptr_host(ptr: *mut c_void) -> *mut UnifiedHost {
    ptr as *mut UnifiedHost
}
// Helper: Get UnifiedHost from vptr_handler1 (offset 8)
unsafe fn host_from_vptr_handler1(ptr: *mut c_void) -> *mut UnifiedHost {
    (ptr as *mut u8).sub(8) as *mut UnifiedHost
}
// Helper: Get UnifiedHost from vptr_handler2 (offset 16)
unsafe fn host_from_vptr_handler2(ptr: *mut c_void) -> *mut UnifiedHost {
    (ptr as *mut u8).sub(16) as *mut UnifiedHost // vptr_host(8) + vptr_handler1(8) = 16 offset
}
// Helper: Get UnifiedHost from vptr_handler3 (offset 24)
unsafe fn host_from_vptr_handler3(ptr: *mut c_void) -> *mut UnifiedHost {
    (ptr as *mut u8).sub(24) as *mut UnifiedHost // 16 + vptr_handler2(8) = 24 offset
}

// Common QueryInterface for UnifiedHost
unsafe fn unified_query_interface(this: *mut UnifiedHost, iid: *const IID, obj: *mut *mut c_void) -> i32 {
    let check = *iid;
    // Debug IID Verbose
    println!("[Native] UnifiedHost::QueryInterface IID: {:08X}-{:04X}-{:04X}-{:02X}{:02X}{:02X}{:02X}{:02X}{:02X}{:02X}{:02X}", 
        check.data[0] as u32 | ((check.data[1] as u32) << 8) | ((check.data[2] as u32) << 16) | ((check.data[3] as u32) << 24),
        check.data[4] as u16 | ((check.data[5] as u16) << 8),
        check.data[6] as u16 | ((check.data[7] as u16) << 8),
        check.data[8], check.data[9], check.data[10], check.data[11],
        check.data[12], check.data[13], check.data[14], check.data[15]);
    use std::io::Write;
    let _ = std::io::stdout().flush();

    if check == <dyn IUnknown as ComInterface>::IID || check == <dyn IHostApplication as ComInterface>::IID {
        // Return vptr_host (start of struct)
        *obj = this as *mut c_void;
        unified_add_ref(this);
        return kResultOk;
    }
    if check == <dyn IComponentHandler as ComInterface>::IID {
        // Return vptr_handler1 (offset 8)
        *obj = (this as *mut u8).add(8) as *mut c_void;
        unified_add_ref(this);
        return kResultOk;
    }
    if check == IID_ICOMPONENTHANDLER2 {
        // Return vptr_handler2 (offset 16)
        *obj = (this as *mut u8).add(16) as *mut c_void;
        unified_add_ref(this);
        return kResultOk;
    }
    if check == IID_ICOMPONENTHANDLER3 {
         println!("[Native] UnifiedHost::QueryInterface -> IComponentHandler3 matched.");
         let _ = std::io::stdout().flush();
        // Return vptr_handler3 (offset 24)
        *obj = (this as *mut u8).add(24) as *mut c_void;
        unified_add_ref(this);
        return kResultOk;
    } else {
        // Debug incorrect match
        // println!("[Native] Check != IID_ICOMPONENTHANDLER3");
    }
    
    kNoInterface
}

unsafe fn unified_add_ref(this: *mut UnifiedHost) -> u32 {
    (*this).ref_count.fetch_add(1, Ordering::Relaxed) as u32 + 1
}
unsafe fn unified_release(this: *mut UnifiedHost) -> u32 {
    let val = (*this).ref_count.fetch_sub(1, Ordering::Relaxed);
    if val == 1 {
        let _ = Box::from_raw(this);
    }
    val as u32 - 1
}

// VTable Implementations for UnifiedHost
unsafe extern "system" fn UnifiedHost_query_interface(this: *mut c_void, iid: *const IID, obj: *mut *mut c_void) -> i32 {
    let myself = host_from_vptr_host(this);
    unified_query_interface(myself, iid, obj)
}
unsafe extern "system" fn UnifiedHost_add_ref(this: *mut c_void) -> u32 {
    let myself = host_from_vptr_host(this);
    unified_add_ref(myself)
}
unsafe extern "system" fn UnifiedHost_release(this: *mut c_void) -> u32 {
    let myself = host_from_vptr_host(this);
    unified_release(myself)
}

unsafe extern "system" fn UnifiedHandler_query_interface1(this: *mut c_void, iid: *const IID, obj: *mut *mut c_void) -> i32 {
    let myself = host_from_vptr_handler1(this);
    unified_query_interface(myself, iid, obj)
}
unsafe extern "system" fn UnifiedHandler_add_ref1(this: *mut c_void) -> u32 {
    let myself = host_from_vptr_handler1(this);
    unified_add_ref(myself)
}
unsafe extern "system" fn UnifiedHandler_release1(this: *mut c_void) -> u32 {
    let myself = host_from_vptr_handler1(this);
    unified_release(myself)
}

unsafe extern "system" fn UnifiedHandler_query_interface2(this: *mut c_void, iid: *const IID, obj: *mut *mut c_void) -> i32 {
    let myself = host_from_vptr_handler2(this);
    unified_query_interface(myself, iid, obj)
}
unsafe extern "system" fn UnifiedHandler_add_ref2(this: *mut c_void) -> u32 {
    let myself = host_from_vptr_handler2(this);
    unified_add_ref(myself)
}
unsafe extern "system" fn UnifiedHandler_release2(this: *mut c_void) -> u32 {
    let myself = host_from_vptr_handler2(this);
    unified_release(myself)
}

unsafe extern "system" fn UnifiedHandler_query_interface3(this: *mut c_void, iid: *const IID, obj: *mut *mut c_void) -> tresult {
    let myself = host_from_vptr_handler3(this);
    unified_query_interface(myself, iid, obj)
}
unsafe extern "system" fn UnifiedHandler_add_ref3(this: *mut c_void) -> u32 {
    let myself = host_from_vptr_handler3(this);
    unified_add_ref(myself)
}
unsafe extern "system" fn UnifiedHandler_release3(this: *mut c_void) -> u32 {
    let myself = host_from_vptr_handler3(this);
    unified_release(myself)
}

fn create_unified_host() -> *mut c_void {
    let host = Box::new(UnifiedHost {
        vptr_host: &HOST_VTBL,
        vptr_handler1: &HANDLER1_VTBL,
        vptr_handler2: &HANDLER2_VTBL,
        vptr_handler3: &HANDLER3_VTBL,
        ref_count: AtomicI32::new(1),
    });
    Box::into_raw(host) as *mut c_void
}

// --- Callback Implementations for UnifiedHost ---

unsafe extern "system" fn HostApplication_get_name(_this: *mut c_void, name: *mut u16) -> i32 {
    let dawiy = "DAWIY HOST".encode_utf16().collect::<Vec<u16>>();
    let dest = std::slice::from_raw_parts_mut(name, 128);
    for (i, &c) in dawiy.iter().enumerate() {
        if i >= 127 { break; }
        dest[i] = c;
    }
    dest[dawiy.len()] = 0;
    // println!("[Native] HostApplication::get_name -> DAWIY HOST");
    kResultOk
}

unsafe extern "system" fn HostApplication_create_instance(_this: *mut c_void, cid: *const IID, _iid: *const IID, obj: *mut *mut c_void) -> i32 {
    let cid_val = *cid;
    println!("[Native] HostApplication::create_instance called. CID: {:08X}-{:04X}-{:04X}-{:02X}{:02X}{:02X}{:02X}{:02X}{:02X}{:02X}{:02X}", 
        cid_val.data[0] as u32 | ((cid_val.data[1] as u32) << 8) | ((cid_val.data[2] as u32) << 16) | ((cid_val.data[3] as u32) << 24),
        cid_val.data[4] as u16 | ((cid_val.data[5] as u16) << 8),
        cid_val.data[6] as u16 | ((cid_val.data[7] as u16) << 8),
        cid_val.data[8], cid_val.data[9], cid_val.data[10], cid_val.data[11],
        cid_val.data[12], cid_val.data[13], cid_val.data[14], cid_val.data[15]);
    
    // Check for IMessage
    if cid_val == IID_IMESSAGE {
        println!("[Native] HostApplication::create_instance -> IMessage created.");
        let _ = std::io::stdout().flush();
        *obj = create_host_message();
        return kResultOk;
    }
    
    // Check for IAttributeList
    if cid_val == IID_IATTRIBUTELIST {
        println!("[Native] HostApplication::create_instance -> IAttributeList created.");
        let _ = std::io::stdout().flush();
        *obj = create_attribute_list();
        return kResultOk;
    }

    println!("[Native] HostApplication::create_instance -> Unknown CID. Not Implemented.");
    kNotImplemented
}

// [Refactor] Duplicate removed


// --- PlugFrame Implementation ---
#[repr(C)]
struct PlugFrame {
    pub vptr: *const IPlugFrameVTableLayout,
    ref_count: AtomicI32,
    hwnd: HWND,
}
#[repr(C)]
struct IPlugFrameVTableLayout {
    pub query_interface: unsafe extern "system" fn(*mut c_void, iid: *const IID, obj: *mut *mut c_void) -> tresult,
    pub add_ref: unsafe extern "system" fn(this: *mut c_void) -> u32,
    pub release: unsafe extern "system" fn(this: *mut c_void) -> u32,
    pub resize_view: unsafe extern "system" fn(*mut c_void, *mut c_void, *mut ViewRect) -> tresult, 
}
static PLUG_FRAME_VTBL: IPlugFrameVTableLayout = IPlugFrameVTableLayout {
    query_interface: PlugFrame_query_interface,
    add_ref: PlugFrame_add_ref,
    release: PlugFrame_release,
    resize_view: PlugFrame_resize_view,
};
unsafe extern "system" fn PlugFrame_query_interface(this: *mut c_void, iid: *const IID, obj: *mut *mut c_void) -> i32 {
    let check = *iid;
    if check != <dyn IUnknown as ComInterface>::IID && check != <dyn IPlugFrame as ComInterface>::IID {
        println!("[Native] PlugFrame::QueryInterface unknown IID: {:?}", check);
    }
    if *iid == <dyn IUnknown as ComInterface>::IID || *iid == <dyn IPlugFrame as ComInterface>::IID {
        *obj = this;
        PlugFrame_add_ref(this);
        return kResultOk;
    }
    kNoInterface
}
unsafe extern "system" fn PlugFrame_add_ref(this: *mut c_void) -> u32 {
    let f = &*(this as *const PlugFrame);
    f.ref_count.fetch_add(1, Ordering::Relaxed) as u32 + 1
}
unsafe extern "system" fn PlugFrame_release(this: *mut c_void) -> u32 {
    let f = &*(this as *const PlugFrame);
    let val = f.ref_count.fetch_sub(1, Ordering::Relaxed);
    val as u32 - 1
}
unsafe extern "system" fn PlugFrame_resize_view(this: *mut c_void, _view: *mut c_void, new_size: *mut ViewRect) -> tresult {
    let f = &*(this as *const PlugFrame);
    if !new_size.is_null() {
        let rect = &*new_size;
        let mut width = rect.right - rect.left;
        let mut height = rect.bottom - rect.top;
        println!("[Native] PlugFrame::resizeView requested: {}x{}", width, height);

        // Enforce Minimum Size to prevent 4x4 loops
        if width < 50 || height < 50 {
             width = 800;
             height = 600;
             println!("[Native] PlugFrame: Enforcing defaults (800x600)");
        }
        
        // Resize window request from Plugin
        let mut win_rect = RECT { left: 0, top: 0, right: width, bottom: height };
        AdjustWindowRect(&mut win_rect, WS_OVERLAPPEDWINDOW, false);
        let full_width = win_rect.right - win_rect.left;
        let full_height = win_rect.bottom - win_rect.top;
        
        SetWindowPos(f.hwnd, None, 0, 0, full_width, full_height, SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE);
    }
    kResultOk
}

fn create_plug_frame(hwnd: HWND) -> *mut c_void {
    let f = Box::new(PlugFrame {
        vptr: &PLUG_FRAME_VTBL,
        ref_count: AtomicI32::new(1),
        hwnd,
    });
    Box::into_raw(f) as *mut c_void
}

// --- IConnectionPoint Definition ---
#[allow(non_snake_case)]
pub trait IConnectionPoint: IUnknown {
    unsafe fn connect(&self, other: *mut c_void) -> tresult;
    unsafe fn disconnect(&self, other: *mut c_void) -> tresult;
    unsafe fn notify(&self, message: *mut c_void) -> tresult;
}

#[repr(C)]
pub struct IConnectionPointVTable {
    pub query_interface: unsafe extern "system" fn(this: *mut c_void, iid: *const IID, obj: *mut *mut c_void) -> tresult,
    pub add_ref: unsafe extern "system" fn(this: *mut c_void) -> u32,
    pub release: unsafe extern "system" fn(this: *mut c_void) -> u32,
    pub connect: unsafe extern "system" fn(this: *mut c_void, other: *mut c_void) -> tresult,
    pub disconnect: unsafe extern "system" fn(this: *mut c_void, other: *mut c_void) -> tresult,
    pub notify: unsafe extern "system" fn(this: *mut c_void, message: *mut c_void) -> tresult,
}

// IID_ICONNECTIONPOINT (vst3-sys/Vital specific: 70A4156F-6E6E-4026-9891-48BFAA60D8D1)
// LE: 6F 15 A4 70 6E 6E 26 40 98 91 48 BF AA 60 D8 D1
const IID_ICONNECTIONPOINT: IID = IID {
    data: [0x6F, 0x15, 0xA4, 0x70, 0x6E, 0x6E, 0x26, 0x40, 0x98, 0x91, 0x48, 0xBF, 0xAA, 0x60, 0xD8, 0xD1],
};

unsafe impl ComInterface for dyn IConnectionPoint {
    type VTable = IConnectionPointVTable;
    type Super = dyn IUnknown;
    const IID: IID = IID_ICONNECTIONPOINT;
}

#[repr(C)]
struct HostConnectionPoint {
    pub vptr: *const IConnectionPointVTable,
    ref_count: AtomicI32,
    other: Mutex<Option<*mut c_void>>, // The thing connected to us
}

unsafe extern "system" fn cp_query_interface(this: *mut c_void, iid: *const IID, obj: *mut *mut c_void) -> tresult {
    let check = *iid;
    if check == <dyn IUnknown as ComInterface>::IID || check == IID_ICONNECTIONPOINT {
         *obj = this;
         cp_add_ref(this);
         return kResultOk;
    }
    kNoInterface
}
unsafe extern "system" fn cp_add_ref(this: *mut c_void) -> u32 {
    let s = &*(this as *const HostConnectionPoint);
    s.ref_count.fetch_add(1, Ordering::Relaxed) as u32 + 1
}
unsafe extern "system" fn cp_release(this: *mut c_void) -> u32 {
    let s = &*(this as *const HostConnectionPoint);
    let val = s.ref_count.fetch_sub(1, Ordering::Relaxed);
    if val == 1 {
        let _ = Box::from_raw(this as *mut HostConnectionPoint);
    }
    val as u32 - 1
}
unsafe extern "system" fn cp_connect(this: *mut c_void, other: *mut c_void) -> tresult {
    let s = &*(this as *const HostConnectionPoint);
    println!("[Native] HostConnectionPoint::connect");
    *s.other.lock().unwrap() = Some(other);
    kResultOk
}
unsafe extern "system" fn cp_disconnect(this: *mut c_void, _other: *mut c_void) -> tresult {
    let s = &*(this as *const HostConnectionPoint);
    println!("[Native] HostConnectionPoint::disconnect");
    *s.other.lock().unwrap() = None;
    kResultOk
}
unsafe extern "system" fn cp_notify(this: *mut c_void, message: *mut c_void) -> tresult {
     let _this = this;
     let _message = message;
     println!("[Native] HostConnectionPoint::notify received message!");
     // We could inspect message info here if we want (via IMessage interface wrapper)
     kResultOk
}

static HOST_CP_VTBL: IConnectionPointVTable = IConnectionPointVTable {
    query_interface: cp_query_interface,
    add_ref: cp_add_ref,
    release: cp_release,
    connect: cp_connect,
    disconnect: cp_disconnect,
    notify: cp_notify,
};

fn create_host_connection_point() -> *mut c_void {
    let cp = Box::new(HostConnectionPoint {
        vptr: &HOST_CP_VTBL,
        ref_count: AtomicI32::new(1),
        other: Mutex::new(None),
    });
    Box::into_raw(cp) as *mut c_void
}

// --- Main Exported Function ---

pub fn load_and_open(path: String, sample_rate: f32) -> Result<u32, String> {
    
    // Setup coordinator if not running
    let mut coord_lock = COORDINATOR.lock().unwrap();
    if coord_lock.is_none() {
        let (tx, rx) = channel();
        *coord_lock = Some(VstCoordinator { tx });
        thread::spawn(move || {
            unsafe { coordinator_main_loop(rx); }
        });
    }
    
    // Clone Sender from Optional
    let tx_main = coord_lock.as_ref().unwrap().tx.clone();
    
    // Release lock early so main thread doesn't block while we wait for GUI creation
    // Although our load command process window sequentially now.
    drop(coord_lock);

    // Send Load Command
    let (tx_res, rx_res) = channel();
    tx_main.send(VstCommand::Load(path, sample_rate, tx_res)).map_err(|e| e.to_string())?;
    
    // Block until creation result (Success or Init Failure)
    let instance_id = rx_res.recv().map_err(|e| format!("Receive error: {}", e))??;
    
    Ok(instance_id)
}

const WM_VST_DROP_INSTANCE: u32 = windows::Win32::UI::WindowsAndMessaging::WM_USER + 4242;

unsafe fn coordinator_main_loop(rx_cmd: Receiver<VstCommand>) {
    OleInitialize(None).ok();
    println!("[Native] VST Coordinator Thread Started. TID: {:?}", std::thread::current().id());
    
    let instance = GetModuleHandleW(None).unwrap();
    let class_name = w!("DAWIY_VST_HOST");
    
    // Register Class (Ignore if already exists)
    let wc = WNDCLASSW {
        hInstance: instance.into(),
        lpszClassName: class_name,
        lpfnWndProc: Some(wnd_proc),
        style: CS_HREDRAW | CS_VREDRAW,
        hCursor: LoadCursorW(None, IDC_ARROW).unwrap(),
        hbrBackground: HBRUSH(GetStockObject(BLACK_BRUSH).0), // Set background to black
        ..Default::default()
    };
    let atom = RegisterClassW(&wc);
    if atom == 0 {
         // println!("[Native] Note: RegisterClassW returned 0 (Class might already exist).");
    }

    let mut instances: Vec<VstInstance> = Vec::new();

    loop {
        // 1. Pump Messages (PeekMessageW for ANY window on this thread)
        let mut msg = MSG::default();
        // PM_REMOVE because we handle them
        while windows::Win32::UI::WindowsAndMessaging::PeekMessageW(&mut msg, None, 0, 0, windows::Win32::UI::WindowsAndMessaging::PM_REMOVE).as_bool() {
             if msg.message == WM_VST_DROP_INSTANCE {
                 let hwnd_val = msg.wParam.0;
                 // Remove instance with this hwnd
                 if let Some(pos) = instances.iter().position(|x| x.hwnd.0 as usize == hwnd_val) {
                     println!("[Native] Coordinator: Dropping Instance for HWND: {}", hwnd_val);
                     instances.remove(pos); // Drop called here (triggers cleanup)
                 }
             }

             if msg.message == windows::Win32::UI::WindowsAndMessaging::WM_QUIT {
                 // If we receive WM_QUIT, it might be for the whole thread?
                 // Usually PostQuitMessage(0) sends it.
                 // We should probably ignore it if it comes from a specific window closure,
                 // but we handle window closure via "Close" logic normally.
                 // For now, let's log it.
                 println!("[Native] Coordinator received WM_QUIT.");
             }
             windows::Win32::UI::WindowsAndMessaging::TranslateMessage(&msg);
             windows::Win32::UI::WindowsAndMessaging::DispatchMessageW(&msg);
        }

        // 2. Check Commands
        match rx_cmd.recv_timeout(std::time::Duration::from_millis(1)) {
            Ok(cmd) => match cmd {
                VstCommand::Load(path, sample_rate, tx_res) => {
                     // We need to refactor run_vst_session to create_vst_instance
                     match create_vst_instance(&path, sample_rate) {
                         Ok(mut inst) => {
                             inst.id = NEXT_INSTANCE_ID.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                             let instance_id = inst.id;
                             instances.push(inst);
                             let _ = tx_res.send(Ok(instance_id));
                         }
                         Err(e) => {
                             let _ = tx_res.send(Err(e));
                         }
                     }
                }
                 VstCommand::Midi(vst_id, status, data1, data2) => {
                     // MIDIイベントをキューに蓄積（get_audio時にまとめてprocessに渡す）
                     for inst in instances.iter_mut() {
                         if inst.id == vst_id {
                             inst.midi_events.push_back((status, data1, data2));
                             //  println!("[Native] MIDI queued for ID {}: s={:#X} d1={} d2={}", vst_id, status, data1, data2);
                             // イベントはキューに積まれ、次のget_audioのprocess内で処理されるためここでは何もしない
                             break;
                         }
                     }
                }
                VstCommand::GetAudio(vst_id, req_samples, tx_audio) => {
                    // 対象インスタンスのプロセスを呼び出してオーディオ生成
                    let mut found = false;
                    for inst in instances.iter_mut() {
                        if inst.id == vst_id {
                            found = true;
                            unsafe {
                                use vst3_sys::vst::{IAudioProcessor, ProcessData, ProcessModes, SymbolicSampleSizes, AudioBusBuffers};
                                let processor_iid = <dyn IAudioProcessor as vst3_com::ComInterface>::IID;
                                let mut processor_ptr: *mut c_void = std::ptr::null_mut();
                                if let Some(comp) = &inst.component {
                                    if comp.query_interface(&processor_iid, &mut processor_ptr) == kResultOk {
                                        let processor = vst3_com::VstPtr::<dyn IAudioProcessor>::owned(processor_ptr as *mut *mut _).unwrap();
                                        
                                        let num_samples = req_samples.min(8192); // Increase upper bound logic
                                        let mut out_l = vec![0.0f32; num_samples];
                                        let mut out_r = vec![0.0f32; num_samples];
                                        let mut channels = vec![out_l.as_mut_ptr() as *mut std::ffi::c_void, out_r.as_mut_ptr() as *mut std::ffi::c_void];
                                        
                                        let mut outputs = vec![AudioBusBuffers {
                                            num_channels: 2,
                                            silence_flags: 0,
                                            buffers: channels.as_mut_ptr(),
                                        }];
                                        
                                        
                                        let mut ctx: vst3_sys::vst::ProcessContext = std::mem::zeroed();
                                        // kPlaying = 1<<1, kContinousTimeValid = 1<<9, kProjectTimeMusicValid = 1<<10
                                        ctx.state = 2 | 512 | 1024;
                                        ctx.sample_rate = inst.sample_rate;
                                        ctx.continuous_time_samples = inst.continuous_time_samples;
                                        ctx.project_time_music = 0.0;
                                        
                                        let mut data = std::mem::zeroed::<ProcessData>();
                                        data.process_mode = ProcessModes::kRealtime as i32;
                                        data.symbolic_sample_size = SymbolicSampleSizes::kSample32 as i32;
                                        data.num_samples = num_samples as i32;
                                        data.num_inputs = 0;
                                        data.num_outputs = 1;
                                        data.outputs = outputs.as_mut_ptr();
                                        data.context = &mut ctx as *mut _;

                                        
                                        // MIDIキューにイベントがあれば一緒に処理
                                        let has_midi = !inst.midi_events.is_empty();
                                        let event_list_ptr = if has_midi {
                                            use vst3_sys::vst::{Event, EventTypes, NoteOnEvent, NoteOffEvent};
                                            let elp = create_host_event_list();
                                            let elvtbl = (*elp).vptr;
                                            while let Some((s, d1, d2)) = inst.midi_events.pop_front() {
                                                let mut event = std::mem::zeroed::<Event>();
                                                event.bus_index = 0;
                                                event.sample_offset = 0;
                                                event.ppq_position = 0.0;
                                                event.flags = 0;
                                                let is_note_on = (s & 0xF0) == 0x90 && d2 > 0;
                                                let is_note_off = (s & 0xF0) == 0x80 || ((s & 0xF0) == 0x90 && d2 == 0);
                                                if is_note_on {
                                                    event.type_ = EventTypes::kNoteOnEvent as u16;
                                                    event.event.note_on = NoteOnEvent {
                                                        channel: (s & 0x0F) as i16,
                                                        pitch: d1 as i16,
                                                        tuning: 0.0,
                                                        velocity: (d2 as f32) / 127.0,
                                                        length: 0,
                                                        note_id: -1,
                                                    };
                                                    ((*elvtbl).add_event)(elp as *mut c_void, &mut event);
                                                } else if is_note_off {
                                                    event.type_ = EventTypes::kNoteOffEvent as u16;
                                                    event.event.note_off = NoteOffEvent {
                                                        channel: (s & 0x0F) as i16,
                                                        pitch: d1 as i16,
                                                        velocity: (d2 as f32) / 127.0,
                                                        note_id: -1,
                                                        tuning: 0.0,
                                                    };
                                                    ((*elvtbl).add_event)(elp as *mut c_void, &mut event);
                                                }
                                            }
                                            data.input_events = std::mem::transmute(elp);
                                            Some(elp)
                                        } else {
                                            None
                                        };
                                        
                                        let _res = processor.process(&mut data);
                                        
                                        inst.continuous_time_samples += num_samples as i64;
                                        
                                        if let Some(elp) = event_list_ptr {
                                            let elvtbl = (*elp).vptr;
                                            ((*elvtbl).release)(elp as *mut c_void);
                                        }
                                        
                                        let _ = tx_audio.send(Ok((out_l, out_r)));
                                    } else {
                                        let _ = tx_audio.send(Err("Failed to get IAudioProcessor".into()));
                                    }
                                } else {
                                    let _ = tx_audio.send(Err("No component".into()));
                                }
                            }
                            break;
                        }
                    }
                    if !found {
                        let _ = tx_audio.send(Err(format!("Instance not found: {}", vst_id)));
                    }
                }
                VstCommand::ProcessAudio(vst_id, req_samples, mut in_l, mut in_r, tx_audio) => {
                    // 対象インスタンスのプロセスを呼び出してオーディオ生成（入力あり）
                    let mut found = false;
                    for inst in instances.iter_mut() {
                        if inst.id == vst_id {
                            found = true;
                            unsafe {
                                use vst3_sys::vst::{IAudioProcessor, ProcessData, ProcessModes, SymbolicSampleSizes, AudioBusBuffers};
                                let processor_iid = <dyn IAudioProcessor as vst3_com::ComInterface>::IID;
                                let mut processor_ptr: *mut c_void = std::ptr::null_mut();
                                if let Some(comp) = &inst.component {
                                    if comp.query_interface(&processor_iid, &mut processor_ptr) == kResultOk {
                                        let processor = vst3_com::VstPtr::<dyn IAudioProcessor>::owned(processor_ptr as *mut *mut _).unwrap();
                                        
                                        let num_samples = req_samples.min(8192);
                                        
                                        // 入力波形の不足分をゼロ埋め
                                        in_l.resize(num_samples, 0.0);
                                        in_r.resize(num_samples, 0.0);

                                        // デバッグ：入力が完全に無音かチェック（一部だけログ出力）
                                        static LOG_COUNTER: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
                                        let count = LOG_COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                                        
                                        let has_signal = in_l.iter().any(|&v| v.abs() > 0.0001);
                                        if has_signal && count % 40 == 0 {
                                             let max_val = in_l.iter().fold(0.0f32, |m, &v| m.max(v.abs()));
                                             println!("[Native] ProcessAudio: SIGNAL DETECTED! Max amplitude: {:.4}, samples: {}", max_val, in_l.len());
                                        }

                                        let mut out_l = vec![0.0f32; num_samples];
                                        let mut out_r = vec![0.0f32; num_samples];
                                        
                                        let mut in_channels = vec![in_l.as_mut_ptr() as *mut std::ffi::c_void, in_r.as_mut_ptr() as *mut std::ffi::c_void];
                                        let mut out_channels = vec![out_l.as_mut_ptr() as *mut std::ffi::c_void, out_r.as_mut_ptr() as *mut std::ffi::c_void];
                                        
                                        // 入力バス
                                        let mut inputs = vec![AudioBusBuffers {
                                            num_channels: 2,
                                            silence_flags: 0,
                                            buffers: in_channels.as_mut_ptr(),
                                        }];
                                        // 出力バス
                                        let mut outputs = vec![AudioBusBuffers {
                                            num_channels: 2,
                                            silence_flags: 0,
                                            buffers: out_channels.as_mut_ptr(),
                                        }];
                                        
                                        let mut ctx: vst3_sys::vst::ProcessContext = std::mem::zeroed();
                                        // kPlaying = 1<<1, kContinousTimeValid = 1<<9, kProjectTimeMusicValid = 1<<10
                                        ctx.state = 2 | 512 | 1024;
                                        ctx.sample_rate = inst.sample_rate;
                                        ctx.continuous_time_samples = inst.continuous_time_samples;
                                        ctx.project_time_music = 0.0;
                                        
                                        let mut data = std::mem::zeroed::<ProcessData>();
                                        data.process_mode = ProcessModes::kRealtime as i32;
                                        data.symbolic_sample_size = SymbolicSampleSizes::kSample32 as i32;
                                        data.num_samples = num_samples as i32;
                                        data.num_inputs = 1; // 1ステレオ入力バス
                                        data.inputs = inputs.as_mut_ptr();
                                        data.num_outputs = 1;
                                        data.outputs = outputs.as_mut_ptr();
                                        data.context = &mut ctx as *mut _;
                                        
                                        // MIDIキューにイベントがあれば一緒に処理
                                        let has_midi = !inst.midi_events.is_empty();
                                        let event_list_ptr = if has_midi {
                                            use vst3_sys::vst::{Event, EventTypes, NoteOnEvent, NoteOffEvent};
                                            let elp = create_host_event_list();
                                            let elvtbl = (*elp).vptr;
                                            while let Some((s, d1, d2)) = inst.midi_events.pop_front() {
                                                let mut event = std::mem::zeroed::<Event>();
                                                event.bus_index = 0;
                                                event.sample_offset = 0;
                                                event.ppq_position = 0.0;
                                                event.flags = 0;
                                                let is_note_on = (s & 0xF0) == 0x90 && d2 > 0;
                                                let is_note_off = (s & 0xF0) == 0x80 || ((s & 0xF0) == 0x90 && d2 == 0);
                                                if is_note_on {
                                                    event.type_ = EventTypes::kNoteOnEvent as u16;
                                                    event.event.note_on = NoteOnEvent {
                                                        channel: (s & 0x0F) as i16,
                                                        pitch: d1 as i16,
                                                        tuning: 0.0,
                                                        velocity: (d2 as f32) / 127.0,
                                                        length: 0,
                                                        note_id: -1,
                                                    };
                                                    ((*elvtbl).add_event)(elp as *mut c_void, &mut event);
                                                } else if is_note_off {
                                                    event.type_ = EventTypes::kNoteOffEvent as u16;
                                                    event.event.note_off = NoteOffEvent {
                                                        channel: (s & 0x0F) as i16,
                                                        pitch: d1 as i16,
                                                        velocity: (d2 as f32) / 127.0,
                                                        note_id: -1,
                                                        tuning: 0.0,
                                                    };
                                                    ((*elvtbl).add_event)(elp as *mut c_void, &mut event);
                                                }
                                            }
                                            data.input_events = std::mem::transmute(elp);
                                            Some(elp)
                                        } else {
                                            None
                                        };
                                        
                                        let _res = processor.process(&mut data);
                                        
                                        inst.continuous_time_samples += num_samples as i64;
                                        
                                        if let Some(elp) = event_list_ptr {
                                            let elvtbl = (*elp).vptr;
                                            ((*elvtbl).release)(elp as *mut c_void);
                                        }
                                        
                                        let _ = tx_audio.send(Ok((out_l, out_r)));
                                    } else {
                                        let _ = tx_audio.send(Err("Failed to get IAudioProcessor".into()));
                                    }
                                } else {
                                    let _ = tx_audio.send(Err("No component".into()));
                                }
                            }
                            break;
                        }
                    }
                    if !found {
                        let _ = tx_audio.send(Err(format!("Instance not found: {}", vst_id)));
                    }
                }
                VstCommand::Close(vst_id) => {
                    println!("[Native] Closing VST instance ID: {}", vst_id);
                    instances.retain(|inst| inst.id != vst_id);
                }
                VstCommand::Show(vst_id) => {
                    let mut found = false;
                    for inst in instances.iter_mut() {
                        if inst.id == vst_id {
                            found = true;
                            if inst.hwnd.0 != 0 {
                                unsafe {
                                    windows::Win32::UI::WindowsAndMessaging::ShowWindow(inst.hwnd, windows::Win32::UI::WindowsAndMessaging::SW_SHOW);
                                    let _ = windows::Win32::UI::WindowsAndMessaging::SetForegroundWindow(inst.hwnd);
                                }
                            }
                            break;
                        }
                    }
                    if !found {
                        println!("[Native] Show called for unknown instance: {}", vst_id);
                    }
                }
            },
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                // Wait is naturally handled by recv_timeout.
                // No dummy audio processing here to avoid stealing samples and breaking continuity.
            },
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                println!("[Native] Coordinator Channel Disconnected. Exiting...");
                break;
            }
        }
        
        // 3. Periodic Tasks
        // We can check params or idle here for all instances
    }
    
    OleUninitialize();
}

// Inner session function (formerly run_vst_thread)
unsafe fn create_vst_instance(path: &str, sample_rate: f32) -> Result<VstInstance, String> {
    // No OleInit here.
    
    println!("[Native] Session started.");
    
    // 1. Create Window Class & Window
    let instance = GetModuleHandleW(None).unwrap();
    let class_name = w!("DAWIY_VST_HOST");

    // No RegisterClassW here (handled by coordinator).
    
    let hwnd = CreateWindowExW(
        WINDOW_EX_STYLE::default(),
        class_name,
        w!("DAWIY Native VST3"),
        WS_OVERLAPPEDWINDOW, 
        CW_USEDEFAULT, CW_USEDEFAULT,
        800, 600,
        None, None, instance, None
    );
    println!("[Native] Dummy window created: {:?}", hwnd);

    // Helper to pump messages
    // Returns false if WM_QUIT received

    
    // 2. Load Plugin
    let path_os: Vec<u16> = std::path::Path::new(path)
        .as_os_str().encode_wide().chain(std::iter::once(0)).collect();
    let lib_handle = LoadLibraryW(PCWSTR(path_os.as_ptr()))
        .map_err(|e| format!("Failed to load DLL: {:?}", e))?;

    let _get_factory_name = s!("GetPluginFactory");
    
    // 0.5 RefCounted InitDll
    let mut should_init = false;
    {
        let mut map = LOADED_LIBRARIES.lock().unwrap();
        let handle_val = lib_handle.0 as isize;
        let count = map.entry(handle_val).or_insert(0);
        if *count == 0 {
            should_init = true;
        }
        *count += 1;
        println!("[Native] Library Loaded. RefCount: {}", *count);
    }

    if should_init {
        // Run InitDll if present
        if !try_init_dll(lib_handle) {
             println!("[Native] InitDll failed.");
             return Err("InitDll failed".into());
        }
    } else {
        println!("[Native] Skipping InitDll (RefCount > 1).");
    }

    // 0. Get Factory and Setup Host Context
    let get_factory_proc = get_factory_proc_address(lib_handle).ok_or("GetPluginFactory not found")?;
    let factory_raw = get_factory_proc();
    if factory_raw.is_null() {
        return Err("GetPluginFactory returned null".into());
    }

    // Wrap in VstPtr for IPluginFactory (V1)
    let factory = VstPtr::<dyn IPluginFactory>::owned(factory_raw as *mut *mut _).unwrap(); // Borrow checks?
    // We shouldn't drop this factory immediately. `factory` var keeps it alive.
    // Wait, CreateInstance is called on `factory_vtbl`.
    
    // Check for IPluginFactory3 to set Host Context
    let mut factory3_ptr: *mut c_void = std::ptr::null_mut();
    // Manual QueryInterface on factory (IUnknown)
    unsafe {
        let res = factory.query_interface(&IID_IPLUGINFACTORY3, &mut factory3_ptr);
        if res == kResultOk && !factory3_ptr.is_null() {
             println!("[Native] Factory supports IPluginFactory3. Setting Host Context...");
             // Create Host App (we need one anyway)
             let host_app = create_unified_host();
             let host_unknown = host_app as *mut c_void;
             
             let factory3_vtbl = *(factory3_ptr as *mut *const IPluginFactory3VTableLayout);
             ((*factory3_vtbl).set_host_context)(factory3_ptr, host_unknown);
             
             // Release factory3
             ((*factory3_vtbl).release)(factory3_ptr);
             
             // We must keep host_app alive?
             // Component takes ownership/reference usually. 
             // But setHostContext implies the factory might use it for creation.
             // We should probably keep `host_app` until createInstance is done.
             // But `host_app` is ref-counted.
             // `create_unified_host` returns a raw pointer with RefCount=1.
             // If Factory AddRef'd it, good. If not, and we drop it?
             // We passed raw pointer. We haven't transferred ownership.
             // If we want to reuse it for component initialization, we should manage it.
             
             // Let's store it to pass to initialize() later if needed, or rely on Factory using it.
             // But `initialize` takes `allocator`? No, `context`.
        }
    }
    
    // We get the raw pointer to the vtable for manual dispatch (since we don't have safe wrapper for createInstance w/ padded CID)
    let factory_ptr = factory_raw as *mut *mut <dyn IPluginFactory as ComInterface>::VTable;
    let factory_vtbl = &**factory_ptr;
    let _this_ptr = factory_ptr as *mut *const <dyn IPluginFactory as ComInterface>::VTable;
    
    // 0.8 Find Audio Module Class
    // Cast factory_ptr to correct type for 'this' argument.
    // factory_vtbl methods expect *mut *const VTable.
    let this_ptr = factory_ptr as *mut *const <dyn IPluginFactory as ComInterface>::VTable;

    let count = (factory_vtbl.CountClasses)(this_ptr);
    println!("[Native] Class count: {}", count);
    
    let mut selected_cid: Option<IID> = None;
    let mut plugin_name = String::from("DAWIY Native VST3");
    
    for i in 0..count {
        let mut info = std::mem::zeroed();
        if (factory_vtbl.GetClassInfo)(this_ptr, i, &mut info) == kResultOk {
             let name = std::ffi::CStr::from_ptr(info.name.as_ptr());
             let category = std::ffi::CStr::from_ptr(info.category.as_ptr());
             let name_str = name.to_string_lossy();
             let category_str = category.to_string_lossy();
             
             println!("[Native] Class {}: {}, Category: {}", i, name_str, category_str);
             
             // vst3_sys::vst::kAudioModuleClass is "Audio Module Class"
             if category_str == "Audio Module Class" {
                 if selected_cid.is_none() {
                    selected_cid = Some(info.cid);
                    plugin_name = name_str.to_string();
                    println!("[Native] Selected Class {} as Audio Module: {}", i, plugin_name);
                }
                 // We could break here, but listing all classes is nice for debug.
             }
        }
    }
    
    if selected_cid.is_none() {
        return Err("No Audio Module Class found".into());
    }
    let cid = selected_cid.unwrap();
    
    // Set Window Title
    let title_wide: Vec<u16> = plugin_name.encode_utf16().chain(std::iter::once(0)).collect();
    SetWindowTextW(hwnd, PCWSTR(title_wide.as_ptr()));
    
    let mut component_ptr: *mut c_void = std::ptr::null_mut();
    let i_component_iid = <dyn IComponent as ComInterface>::IID; 
    unsafe fn pump_messages() {
        use windows::Win32::UI::WindowsAndMessaging::{PeekMessageW, DispatchMessageW, TranslateMessage, PM_REMOVE, MSG};
        let mut msg = MSG::default();
        // Pump until queue is empty
        while PeekMessageW(&mut msg, None, 0, 0, PM_REMOVE).as_bool() {
             if msg.message == windows::Win32::UI::WindowsAndMessaging::WM_QUIT {
                 println!("[Native] WM_QUIT received in pump_messages.");
             }
             let _ = TranslateMessage(&msg);
             let _ = DispatchMessageW(&msg);
        }
    }

    // 1. Initialize Component
    println!("[Native] Creating component...");
    
    // Construct Padded Binary CID
    let mut cid_buffer = [0u8; 32];
    cid_buffer[0..16].copy_from_slice(&cid.data);
    
    let mut iid_buffer = [0u8; 32];
    iid_buffer[0..16].copy_from_slice(&i_component_iid.data);

    println!("[Native] Target CID (Padded): {:02X}{:02X}{:02X}{:02X}...", 
        cid_buffer[0], cid_buffer[1], cid_buffer[2], cid_buffer[3]);
    
    use std::io::Write; 
    let _ = std::io::stdout().flush();

    // Pass pointer to padded buffer, cast to *const IID
    let cid_ptr_cast = cid_buffer.as_ptr() as *const IID;
    let iid_ptr_cast = iid_buffer.as_ptr() as *const IID;

    if (factory_vtbl.CreateInstance)(this_ptr, cid_ptr_cast, iid_ptr_cast, &mut component_ptr) != kResultOk {
            println!("[Native] Factory::CreateInstance returned error.");
            return Err("Failed to create component".into());
    }
    println!("[Native] CreateInstance returned OK. Ptr: {:?}", component_ptr);
    let _ = std::io::stdout().flush();
    
    let component = VstPtr::<dyn IComponent>::owned(component_ptr as *mut *mut _).unwrap();
    println!("[Native] Component created.");
    
    // Unified Host Creation
    let host_app = create_unified_host();
    
    // Try kAdvanced instead of kSimple
    component.set_io_mode(vst3_sys::vst::IoModes::kAdvanced as i32);
    if component.initialize(host_app as *mut c_void) != kResultOk {
            return Err("Failed initialize".into());
    }
    println!("[Native] Component initialized.");

    // Activate Bus AFTER State Sync? (Try restoring here)
    println!("[Native] Activating Output Bus 0 (Delayed)...");
    // Activate Bus AFTER State Sync? (Try restoring here)
    println!("[Native] Activating Input Bus 0...");
    if component.activate_bus(MediaTypes::kAudio as i32, BusDirections::kInput as i32, 0, 1) != kResultOk {
         println!("[Native] Failed to activate input bus.");
    } else {
        // println!("[Native] Input Bus 0 activated.");
    }

    println!("[Native] Activating Output Bus 0 (Delayed)...");
     if component.activate_bus(MediaTypes::kAudio as i32, BusDirections::kOutput as i32, 0, 1) != kResultOk {
          println!("[Native] Failed to activate output bus.");
     } else {
         // println!("[Native] Output Bus 0 activated.");
     }

    // 4. Edit Controller
    let edit_controller: VstPtr<dyn IEditController>;
    
    // Check if Component implements IEditController
    let i_edit_controller_iid = <dyn IEditController as ComInterface>::IID;
    let mut edit_controller_ptr: *mut c_void = std::ptr::null_mut();
    
    println!("[Native] Checking for separate controller...");
    // Try to query from component first
    if component.query_interface(&i_edit_controller_iid, &mut edit_controller_ptr) == kResultOk {
         println!("[Native] Component implements IEditController.");
         edit_controller = VstPtr::<dyn IEditController>::owned(edit_controller_ptr as *mut *mut _).unwrap();
    } else {
        println!("[Native] Has separate controller class.");
        // Look for Controller Class
        let mut controller_cid: Option<IID> = None;
        for i in 0..count {
            let mut info = std::mem::zeroed();
             if (factory_vtbl.GetClassInfo)(this_ptr, i, &mut info) == kResultOk {
                 let category = std::ffi::CStr::from_ptr(info.category.as_ptr());
                 if category.to_string_lossy() == "Component Controller Class" {
                     // Check if it belongs to our component (by some logic? or just assume subsequent?)
                     // Usually libraries have 1 AudioModule and 1 ComponentController.
                     // Vital has Class 0: Audio Module, Class 1: Component Controller.
                     // We just pick the first one we find.
                     controller_cid = Some(info.cid);
                     break;
                 }
            }
        }
        
        if let Some(ccid) = controller_cid {
            let mut edit_controller_ptr_sep: *mut c_void = std::ptr::null_mut();
            
             // Construct Padded Binary CID for Controller
            let mut ccid_buffer = [0u8; 32];
            ccid_buffer[0..16].copy_from_slice(&ccid.data);
            let ccid_ptr_cast = ccid_buffer.as_ptr() as *const IID;

            if (factory_vtbl.CreateInstance)(this_ptr, ccid_ptr_cast, &i_edit_controller_iid, &mut edit_controller_ptr_sep) == kResultOk {
                println!("[Native] Separate Controller created.");
                edit_controller = VstPtr::<dyn IEditController>::owned(edit_controller_ptr_sep as *mut *mut _).unwrap();
                
                // Initialize Controller with Host Context too!
                if edit_controller.initialize(host_app as *mut c_void) != kResultOk {
                    println!("[Native] Failed to initialize separate controller.");
                } else {
                     println!("[Native] Separate Controller initialized with Unified Host.");
                }
            } else {
                 return Err("Failed to create separate controller".into());
            }
        } else {
             println!("[Native] No separate controller found. Assuming Component is Controller (but QI failed?).");
             // Some plugins might be strictly separated but we failed to find class?
             // Or maybe QI failed for some other reason.
             println!("[Native] INFO: Component does NOT implement IEditController.");
             // We can proceed without UI if we want processing only.
             // But for now, let's assume UI is required.
             // return Err("No InitController found".into());
             
             // Fallback: Create Dummy Controller wrapper? Or just fail?
             // Vital works.
             // Let's assume valid pointer if we reached here? No.
             return Err("Component does not implement IEditController and no separate class found.".into());
        }
    }

    // 5. Connect Component and Controller
    use vst3_sys::vst::IComponentHandler;
    let i_component_handler_iid = <dyn IComponentHandler as ComInterface>::IID;
    let mut handler_ptr: *mut c_void = std::ptr::null_mut();
    
    // We already have host_app which implements IComponentHandler (UnifiedHost). 
    // We need to pass it to set_component_handler.
    // QueryInterface on host_app for IComponentHandler
    unsafe {
         let unified_unknown = host_app as *mut c_void;
         let unified_vtbl = *(unified_unknown as *mut *const IHostApplicationVTableLayout); 
         if ((*unified_vtbl).query_interface)(unified_unknown, &i_component_handler_iid, &mut handler_ptr) == kResultOk {
               let handler = VstPtr::<dyn IComponentHandler>::owned(handler_ptr as *mut *mut _).unwrap();
               // Cast VstPtr (Smart Ptr) to raw pointer, then transmute to SharedVstPtr (Structure wrapping raw ptr)
               // set_component_handler takes SharedVstPtr<dyn IComponentHandler>
               // SharedVstPtr is #[repr(transparent)] wrapper around *mut *mut T
               let shared_handler: vst3_sys::utils::SharedVstPtr<dyn IComponentHandler> = std::mem::transmute(handler.as_ptr());
               if edit_controller.set_component_handler(shared_handler) == kResultOk {
                    println!("[Native] Component Handler set.");
               }
         }
    }
    
    // 6. Synchronize State (if Controller is separate)
    // Only needed if they are separate instances.
    
    // Check interfaces
    use vst3_sys::vst::IUnitInfo;
    let unit_info_iid = <dyn IUnitInfo as ComInterface>::IID;
    let mut unit_info_ptr: *mut c_void = std::ptr::null_mut();
    if edit_controller.query_interface(&unit_info_iid, &mut unit_info_ptr) == kResultOk {
         println!("[Native] Controller supports IUnitInfo.");
         let unit_info = VstPtr::<dyn IUnitInfo>::owned(unit_info_ptr as *mut *mut _).unwrap();
         let unit_count = unit_info.get_unit_count();
         println!("[Native] Unit Count: {}", unit_count);
         
         let prog_list_count = unit_info.get_program_list_count();
         println!("[Native] Program List Count: {}", prog_list_count);
         
         if unit_count > 0 {
             let mut info = std::mem::zeroed();
             if unit_info.get_unit_info(0, &mut info) == kResultOk {
                  let name_u16: Vec<u16> = info.name.iter().map(|&c| c as u16).take_while(|&c| c != 0).collect();
                  let name = String::from_utf16_lossy(&name_u16);
                  println!("[Native] Unit 0 Name: {}", name);
             }
         }
    }
    
    use vst3_sys::vst::IMidiMapping;
    let midi_mapping_iid = <dyn IMidiMapping as ComInterface>::IID;
    let mut midi_ptr: *mut c_void = std::ptr::null_mut();
     if edit_controller.query_interface(&midi_mapping_iid, &mut midi_ptr) == kResultOk {
         println!("[Native] Controller supports IMidiMapping.");
    }

    // Checking IEditController2
    let i_edit_controller2_iid = IID { data: [0x50, 0x16, 0x82, 0x7E, 0x51, 0x69, 0x57, 0x44, 0xAF, 0x8D, 0x74, 0x47, 0x1D, 0x07, 0xE9, 0x90] };
    let mut edit_ctrl2_ptr: *mut c_void = std::ptr::null_mut();
    if edit_controller.query_interface(&i_edit_controller2_iid, &mut edit_ctrl2_ptr) == kResultOk {
        println!("[Native] Controller supports IEditController2.");
    }

    // Connection Point Handshake
    use vst3_sys::vst::IConnectionPoint;
    let cp_iid = IID_ICONNECTIONPOINT;
    let mut comp_cp_ptr: *mut c_void = std::ptr::null_mut();
    let mut ctrl_cp_ptr: *mut c_void = std::ptr::null_mut();
    
    println!("[Native] Attempting ConnectionPoint Handshake...");
    let res_comp = component.query_interface(&cp_iid, &mut comp_cp_ptr);
    let res_ctrl = edit_controller.query_interface(&cp_iid, &mut ctrl_cp_ptr);
    
    if res_comp == kResultOk && !comp_cp_ptr.is_null() && res_ctrl == kResultOk && !ctrl_cp_ptr.is_null() {
             println!("[Native] Both support IConnectionPoint. Connecting...");
             
             let comp_cp = VstPtr::<dyn IConnectionPoint>::owned(comp_cp_ptr as *mut *mut _).unwrap();
             let ctrl_cp = VstPtr::<dyn IConnectionPoint>::owned(ctrl_cp_ptr as *mut *mut _).unwrap();
             
             // Connect Logic:
             // Usually Host connects Component -> Controller and Controller -> Component
             
             let this_comp = comp_cp.as_ptr() as *mut c_void;
             let this_ctrl = ctrl_cp.as_ptr() as *mut c_void;
             let vptr_comp = *(this_comp as *mut *const IConnectionPointVTable);
             
             let res_conn1 = ((*vptr_comp).connect)(this_comp, ctrl_cp.as_ptr() as *mut c_void);
             println!("[Native] IConnectionPoint::Connect (Comp->Ctrl) Result: {}", res_conn1);
             
             let vptr_ctrl = *(this_ctrl as *mut *const IConnectionPointVTable);
             let res_conn2 = ((*vptr_ctrl).connect)(this_ctrl, comp_cp.as_ptr() as *mut c_void);
             println!("[Native] IConnectionPoint::Connect (Ctrl->Comp) Result: {}", res_conn2);
             
             println!("[Native] Connected.");
             let _ = std::io::stdout().flush();
    } else {
             println!("[Native] ConnectionPoint Handshake Failed or Unsupported (Comp: {:?}/{}, Ctrl: {:?}/{}).", res_comp, !comp_cp_ptr.is_null(), res_ctrl, !ctrl_cp_ptr.is_null());
             // Fallback: State Synchronization via IBStream... (Omitted for brevity in refactor)
             
             // Define IBStream VTable and Struct
             #[repr(C)]
        pub struct IBStreamVTable {
            pub query_interface: unsafe extern "system" fn(this: *mut c_void, iid: *const IID, obj: *mut *mut c_void) -> tresult,
            pub add_ref: unsafe extern "system" fn(this: *mut c_void) -> u32,
            pub release: unsafe extern "system" fn(this: *mut c_void) -> u32,
            pub read: unsafe extern "system" fn(this: *mut c_void, buffer: *mut c_void, num_bytes: i32, num_bytes_read: *mut i32) -> tresult,
            pub write: unsafe extern "system" fn(this: *mut c_void, buffer: *mut c_void, num_bytes: i32, num_bytes_written: *mut i32) -> tresult,
            pub seek: unsafe extern "system" fn(this: *mut c_void, pos: i64, mode: i32, result: *mut i64) -> tresult,
            pub tell: unsafe extern "system" fn(this: *mut c_void, result: *mut i64) -> tresult,
            pub get_stream_size: unsafe extern "system" fn(this: *mut c_void, size: *mut i64) -> tresult,
            pub set_stream_size: unsafe extern "system" fn(this: *mut c_void, size: i64) -> tresult,
        }
        
        #[repr(C)]
        struct HostMemoryStream {
            pub vptr: *const IBStreamVTable,
            ref_count: AtomicI32,
            data: Mutex<Vec<u8>>,
            cursor: Mutex<usize>,
        }
        
        unsafe extern "system" fn stream_query_interface(this: *mut c_void, iid: *const IID, obj: *mut *mut c_void) -> i32 {
             // use std::io::Write;
            let check = *iid;
            // let iid_guid = format!("{:?}", check); 
            // println!("[Native] IBStream::QueryInterface IID: {}", iid_guid);
            // let _ = std::io::stdout().flush();
            
            // IID_IBStream OR IUnknown
            if check == <dyn IUnknown as ComInterface>::IID {
                 // println!("[Native] IBStream::QueryInterface -> IUnknown matched.");
                 *obj = this;
                 stream_add_ref(this);
                 return kResultOk;
            }
             let iid_ibstream = <dyn vst3_sys::base::IBStream as ComInterface>::IID;
             if check == iid_ibstream {
                 // println!("[Native] IBStream::QueryInterface -> IBStream matched.");
                 *obj = this;
                 stream_add_ref(this);
                 return kResultOk;
             }
             
             // ISizeableStream check
             let iid_isizeablestream = IID { data: [0xE2, 0x93, 0xD4, 0x6C, 0x5D, 0x05, 0xCB, 0x47, 0x91, 0xA4, 0xDE, 0x48, 0x60, 0x92, 0xFF, 0x76] };
             if check == iid_isizeablestream { // 6CD493E2...
                  // println!("[Native] IBStream::QueryInterface -> ISizeableStream matched.");
                  *obj = this;
                  stream_add_ref(this);
                  return kResultOk;
             }

            // println!("[Native] IBStream::QueryInterface Unknown IID: {:?}", check);
            kNoInterface
        }
        unsafe extern "system" fn stream_add_ref(this: *mut c_void) -> u32 {
            let s = &*(this as *const HostMemoryStream);
            s.ref_count.fetch_add(1, Ordering::Relaxed) as u32 + 1
        }
        unsafe extern "system" fn stream_release(this: *mut c_void) -> u32 {
            let s = &*(this as *const HostMemoryStream);
            let val = s.ref_count.fetch_sub(1, Ordering::Relaxed);
            if val == 1 {
                let _ = Box::from_raw(this as *mut HostMemoryStream);
            }
            val as u32 - 1
        }
        unsafe extern "system" fn stream_read(this: *mut c_void, buffer: *mut c_void, num_bytes: i32, num_bytes_read: *mut i32) -> tresult {
             // use std::io::Write;
             let s = &*(this as *const HostMemoryStream);
             let data = s.data.lock().unwrap();
             let mut cursor_guard = s.cursor.lock().unwrap();
             let cursor = *cursor_guard;
             
             let available = data.len().saturating_sub(cursor);
             let to_read = std::cmp::min(available, num_bytes as usize);
             
             // println!("[Native] IBStream::read req={} avail={} cursor={} len={} -> reading {}", num_bytes, available, cursor, data.len(), to_read);
             
             if to_read > 0 {
                std::ptr::copy_nonoverlapping(data.as_ptr().add(cursor), buffer as *mut u8, to_read);
                *cursor_guard += to_read;
             }
             
             if !num_bytes_read.is_null() {
                 *num_bytes_read = to_read as i32;
             }
             
             kResultOk
        }

        unsafe extern "system" fn stream_write(this: *mut c_void, buffer: *mut c_void, num_bytes: i32, num_bytes_written: *mut i32) -> tresult {
             // println!("[Native] IBStream::write req={}", num_bytes);
             let s = &*(this as *const HostMemoryStream);
             let mut data = s.data.lock().unwrap();
             let mut cursor_guard = s.cursor.lock().unwrap();
             let cursor = *cursor_guard;
             
             let required_len = cursor + num_bytes as usize;
             if required_len > data.len() {
                 data.resize(required_len, 0);
             }
             
             std::ptr::copy_nonoverlapping(buffer as *const u8, data.as_mut_ptr().add(cursor), num_bytes as usize);
             *cursor_guard += num_bytes as usize;
             
             if !num_bytes_written.is_null() {
                 *num_bytes_written = num_bytes as i32;
             }
             kResultOk
        }

        unsafe extern "system" fn stream_seek(this: *mut c_void, pos: i64, mode: i32, result: *mut i64) -> tresult {
            let s = &*(this as *const HostMemoryStream);
            let mut cursor_guard = s.cursor.lock().unwrap();
            let current = *cursor_guard as i64;
            let len = s.data.lock().unwrap().len() as i64;
            
            let new_pos = match mode {
                0 => pos, // SeekSet
                1 => current + pos, // SeekCur
                2 => len + pos, // SeekEnd
                _ => return -1, // kInvalidArgument
            };
            
            // println!("[Native] IBStream::seek mode={} pos={} (cur={} len={}) -> new_pos={}", mode, pos, current, len, new_pos);

            if new_pos < 0 || new_pos > len {
                // println!("[Native] IBStream::seek INVALID POSITION");
                return -1; // Error
            }
            *cursor_guard = new_pos as usize;
            if !result.is_null() {
                *result = new_pos;
            }
            kResultOk
        }
        unsafe extern "system" fn stream_tell(this: *mut c_void, result: *mut i64) -> tresult {
            let s = &*(this as *const HostMemoryStream);
            if !result.is_null() {
                *result = *s.cursor.lock().unwrap() as i64;
            }
            kResultOk
        }

        unsafe extern "system" fn stream_get_stream_size(this: *mut c_void, size: *mut i64) -> tresult {
            let s = &*(this as *const HostMemoryStream);
            let len = s.data.lock().unwrap().len() as i64;
            // println!("[Native] ISizeableStream::get_stream_size -> {}", len);
            if !size.is_null() {
                *size = len;
            }
            kResultOk
        }
        
        unsafe extern "system" fn stream_set_stream_size(_this: *mut c_void, _size: i64) -> tresult {
             // println!("[Native] ISizeableStream::set_stream_size -> Not Implemented (Read Only)");
             // Should we implement? For now ok.
             kNotImplemented 
        }

        static STREAM_VTBL: IBStreamVTable = IBStreamVTable {
            // ... (unchanged)
            query_interface: stream_query_interface,
            add_ref: stream_add_ref,
            release: stream_release,
            read: stream_read,
            write: stream_write,
            seek: stream_seek,
            tell: stream_tell,
            get_stream_size: stream_get_stream_size,
            set_stream_size: stream_set_stream_size,
        };

        let stream_ptr = Box::into_raw(Box::new(HostMemoryStream {
            vptr: &STREAM_VTBL,
            ref_count: AtomicI32::new(1),
            data: Mutex::new(Vec::new()),
            cursor: Mutex::new(0),
        })) as *mut c_void;
        
        // Wrap for VstPtr
        use vst3_sys::vst::IComponent;
        use vst3_sys::base::IBStream;
        use vst3_sys::utils::SharedVstPtr;

        // transmute raw pointer to SharedVstPtr<dyn IBStream>
        // SharedVstPtr is transparent wrapper around *mut *mut VTable.
        // stream_ptr is *mut HostMemoryStream, which starts with *const VTable.
        let ibstream_wrapper: SharedVstPtr<dyn IBStream> = std::mem::transmute(stream_ptr);

        println!("[Native] Getting state from component...");
        if component.get_state(ibstream_wrapper) == kResultOk {
             println!("[Native] Read state from component. Size: {} bytes.", (*(stream_ptr as *mut HostMemoryStream)).data.lock().unwrap().len());
             
             // Rewind
              *(*(stream_ptr as *mut HostMemoryStream)).cursor.lock().unwrap() = 0;
             
             // 2. Set State to Controller
             println!("[Native] Setting state to controller...");
             let _ = std::io::stdout().flush();
             // Re-create wrapper because SharedVstPtr<dyn IBStream> is not Copy
             let ibstream_wrapper_ctrl: SharedVstPtr<dyn IBStream> = std::mem::transmute(stream_ptr);
             
             let res_sync = edit_controller.set_component_state(ibstream_wrapper_ctrl);
             if res_sync == kResultOk {
                  println!("[Native] State sync successful (set_component_state)!");
             } else {
                  println!("[Native] Controller rejected set_component_state. Error Code: {}", res_sync);
                  
                  // Try explicit set_state (Controller State)
                  // Rewind again
                 *(*(stream_ptr as *mut HostMemoryStream)).cursor.lock().unwrap() = 0;
                  println!("[Native] Attempting edit_controller.set_state (fallback)...");
                  let _ = std::io::stdout().flush();
                  
                  // Re-create wrapper again
                  let ibstream_wrapper_ctrl2: SharedVstPtr<dyn IBStream> = std::mem::transmute(stream_ptr);
                  let res_state = edit_controller.set_state(ibstream_wrapper_ctrl2);
                  if res_state == kResultOk {
                       println!("[Native] edit_controller.set_state successful!");
                  } else {
                       println!("[Native] edit_controller.set_state failed. Error Code: {}", res_state);
                  }
             }
        } else {
            println!("[Native] Failed to get state from component.");
        }
        
        // Release stream
        stream_release(stream_ptr);
    } // End of else (ConnectionPoint failed)

    // 1. Create View (Init -> Controller -> View)
    println!("[Native] Creating view...");
    let mut fs_name = [0u8; 128]; 
    let mut view_ptr_void = edit_controller.create_view(fs_name.as_ptr() as *const i8);
    let mut view_ptr_void2: *mut c_void = std::ptr::null_mut();
    
    if view_ptr_void.is_null() {
        println!("[Native] '' failed. Trying 'editor'...");
        let editor_s = b"editor\0";
        for (i, &b) in editor_s.iter().enumerate() { fs_name[i] = b; }
        view_ptr_void2 = edit_controller.create_view(fs_name.as_ptr() as *const i8);
        if !view_ptr_void2.is_null() {
             println!("[Native] 'editor' worked.");
             view_ptr_void = view_ptr_void2;
             println!("[Native] View created with 'editor'.");
        }
    }
    
    if view_ptr_void.is_null() && view_ptr_void2.is_null() {
        println!("[Native] create_view returned NULL. Trying QueryInterface<IPlugView>...");
        let i_view_iid = <dyn IPlugView as ComInterface>::IID;
        let mut view_ptr_qi: *mut c_void = std::ptr::null_mut();
        if edit_controller.query_interface(&i_view_iid, &mut view_ptr_qi) == kResultOk {
             println!("[Native] Success! Controller implements IPlugView.");
             view_ptr_void = view_ptr_qi;
        } else {
             println!("[Native] Controller does not implement IPlugView.");
        }
    }
    
    let mut view: Option<VstPtr<dyn IPlugView>> = None;
    if !view_ptr_void.is_null() {
          view = Some(VstPtr::<dyn IPlugView>::owned(view_ptr_void as *mut *mut _).unwrap());
          println!("[Native] View created successfully.");
    }
    
    // 2. Audio Bus Initialization & Arrangement
    use vst3_sys::vst::{IAudioProcessor, BusDirections, MediaTypes, ProcessSetup, ProcessModes, SymbolicSampleSizes};
    let processor_iid = <dyn IAudioProcessor as ComInterface>::IID;
    let mut processor_ptr: *mut c_void = std::ptr::null_mut();
    if component.query_interface(&processor_iid, &mut processor_ptr) == kResultOk {
        println!("[Native] IAudioProcessor interface obtained.");
        let processor = VstPtr::<dyn IAudioProcessor>::owned(processor_ptr as *mut *mut _).unwrap();
        
        let num_inputs = component.get_bus_count(MediaTypes::kAudio as i32, BusDirections::kInput as i32);
        let num_outputs = component.get_bus_count(MediaTypes::kAudio as i32, BusDirections::kOutput as i32);
        println!("[Native] Bus Count: Inputs={}, Outputs={}", num_inputs, num_outputs);

        let mut input_arrangements = vec![3u64; num_inputs as usize];
        let mut output_arrangements = vec![3u64; num_outputs as usize];
        
        let input_ptr = if num_inputs > 0 { input_arrangements.as_mut_ptr() } else { std::ptr::null_mut() };
        let output_ptr = if num_outputs > 0 { output_arrangements.as_mut_ptr() } else { std::ptr::null_mut() };

        println!("[Native] Setting Bus Arrangements...");
        if processor.set_bus_arrangements(input_ptr, num_inputs, output_ptr, num_outputs) == kResultOk {
             println!("[Native] Bus Arrangement set successfully.");
        } else {
             println!("[Native] Failed to set Bus Arrangement.");
        }
        
        // 3. Setup Processing (Right before activation)
        let can_32 = processor.can_process_sample_size(SymbolicSampleSizes::kSample32 as i32) == kResultOk;
        let can_64 = processor.can_process_sample_size(SymbolicSampleSizes::kSample64 as i32) == kResultOk;
        println!("[Native] AudioProcessor Capabilities: 32-bit={}, 64-bit={}", can_32, can_64);
        
        let symbolic_sample_size = if can_64 {
            SymbolicSampleSizes::kSample64 as i32
        } else {
            SymbolicSampleSizes::kSample32 as i32
        };

        let setup = ProcessSetup {
            process_mode: ProcessModes::kRealtime as i32,
            symbolic_sample_size,
            max_samples_per_block: 4096,
            sample_rate: sample_rate as f64,
        };
        println!("[Native] ProcessSetup Size: {} bytes, Align: {}", std::mem::size_of::<ProcessSetup>(), std::mem::align_of::<ProcessSetup>());
        println!("[Native] Setting up processing (SR=44100, Block=512, Sample={}-bit)...", if symbolic_sample_size == SymbolicSampleSizes::kSample64 as i32 { 64 } else { 32 });
        if processor.setup_processing(&setup) == kResultOk {
             println!("[Native] Processing setup successful.");
        } else {
             println!("[Native] Failed to setup processing.");
        }
        
        println!("[Native] Setting processing to true...");
        if processor.set_processing(1) == kResultOk {
             println!("[Native] set_processing(1) successful.");
        } else {
             println!("[Native] Failed to set_processing(1).");
        }
    }
    
    // Activate Component
    println!("[Native] Activating component...");
    let _ = std::io::stdout().flush();
    if component.set_active(1) != kResultOk {
        println!("[Native] WARNING: Failed to activate component.");
    } else {
        println!("[Native] Component activated.");
    }
    
    // Parameter Scan (Post-Activation)
    println!("[Native] Scanning parameters (Post-Activation)...");
    let param_count = edit_controller.get_parameter_count();
    println!("[Native] Parameter Count: {}", param_count);
    for i in 0..std::cmp::min(5, param_count) {
        let mut info = std::mem::zeroed();
        if edit_controller.get_parameter_info(i, &mut info) == kResultOk {
            let title_u16: Vec<u16> = info.title.iter().map(|&c| c as u16).take_while(|c| *c != 0).collect();
            let title = String::from_utf16_lossy(&title_u16);
             println!("[Native] Param {}: {}", i, title);
        }
    }







    /* 
    if view_ptr_void.is_null() {
            println!("[Native] create_view returned NULL.");
            // return Err("No view returned from create_view".into()); // ALLOW CONTINUE
    }
    let view = VstPtr::<dyn IPlugView>::owned(view_ptr_void as *mut *mut _).unwrap();
    println!("[Native] View created.");
    */
    
    /* 
    if !view_ptr_void.is_null() {
         view = Some(VstPtr::<dyn IPlugView>::owned(view_ptr_void as *mut *mut _).unwrap());
         println!("[Native] View created immediately.");
    } else {
         println!("[Native] View creation invalid. Entering loop and will retry...");
    }
    */

    if let Some(ref v) = view {
        // Attach View info to Window for Resize
        let view_raw_interface = v.as_ptr(); 
        SetWindowLongPtrW(hwnd, GWLP_USERDATA, view_raw_interface as isize);
        
        let mut rect = vst3_sys::gui::ViewRect::default();
        v.get_size(&mut rect);
        let mut width = rect.right - rect.left;
        let mut height = rect.bottom - rect.top;
        if width < 50 || height < 50 { width = 800; height = 600; }
        let mut win_rect = RECT { left: 0, top: 0, right: width, bottom: height };
        AdjustWindowRect(&mut win_rect, WS_OVERLAPPEDWINDOW, false);
        SetWindowPos(hwnd, None, 0, 0, win_rect.right - win_rect.left, win_rect.bottom - win_rect.top, SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE);
        
        // Attach
        println!("[Native] Creating PlugFrame...");
        let plug_frame = create_plug_frame(hwnd);
        println!("[Native] PlugFrame created.");
        
        println!("[Native] Setting frame...");
        v.set_frame(plug_frame);
        println!("[Native] Frame set.");
        
        let type_hwnd = s!("HWND").as_ptr() as *const std::ffi::c_char;
        println!("[Native] Attaching view...");
        match v.attached(hwnd.0 as *mut c_void, type_hwnd) {
             kResultOk => println!("[Native] Attached successfully."),
             err => println!("[Native] Attach failed: {}", err),
        }
        
        println!("[Native] Showing Window...");
        ShowWindow(hwnd, SW_SHOW);
    } else {
        println!("[Native] No View provided. Running in Headless mode.");
        
        // Set Title to indicate No GUI
        use windows::Win32::UI::WindowsAndMessaging::SetWindowTextW;
        let title_no_gui = w!("DAWIY Native VST3 - (No GUI)");
        SetWindowTextW(hwnd, title_no_gui);
        
        // Resize to small default
        let mut win_rect = RECT { left: 0, top: 0, right: 300, bottom: 100 };
        AdjustWindowRect(&mut win_rect, WS_OVERLAPPEDWINDOW, false);
        SetWindowPos(hwnd, None, 0, 0, win_rect.right - win_rect.left, win_rect.bottom - win_rect.top, SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE);
        
        ShowWindow(hwnd, SW_SHOW);
    }
    
    // Set Timer for retry (every 1000ms)
    SetTimer(hwnd, 1, 1000, None);

    
    // Return Instance
    Ok(VstInstance {
        id: 0, // Assigned by coordinator later
        hwnd,
        lib_handle,
        factory: Some(factory),
        path: path.to_string(),
        component: Some(component),
        edit_controller: Some(edit_controller),
        view,
        midi_events: std::collections::VecDeque::new(),
        sample_rate: sample_rate as f64,
        continuous_time_samples: 0,
    })
}




use std::os::windows::ffi::OsStrExt;

// --- IPluginFactory3 Definition ---
#[repr(C)]
struct IPluginFactory3VTableLayout {
    pub query_interface: unsafe extern "system" fn(this: *mut c_void, iid: *const IID, obj: *mut *mut c_void) -> tresult,
    pub add_ref: unsafe extern "system" fn(this: *mut c_void) -> u32,
    pub release: unsafe extern "system" fn(this: *mut c_void) -> u32,
    pub get_factory_info: unsafe extern "system" fn(this: *mut c_void, info: *mut c_void) -> tresult,
    pub count_classes: unsafe extern "system" fn(this: *mut c_void) -> i32,
    pub get_class_info: unsafe extern "system" fn(this: *mut c_void, index: i32, info: *mut c_void) -> tresult,
    pub create_instance: unsafe extern "system" fn(this: *mut c_void, cid: *const IID, iid: *const IID, obj: *mut *mut c_void) -> tresult,
    pub get_class_info2: unsafe extern "system" fn(this: *mut c_void, index: i32, info: *mut c_void) -> tresult,
    pub set_host_context: unsafe extern "system" fn(this: *mut c_void, context: *mut c_void) -> tresult,
}

// 4555A2EE-C548-4458-8B7D-4340C97F37F8
const IID_IPLUGINFACTORY3: IID = IID {
    data: [0xEE, 0xA2, 0x55, 0x45, 0x48, 0xC5, 0x58, 0x44, 0x8B, 0x7D, 0x43, 0x40, 0xC9, 0x7F, 0x37, 0xF8],
};

fn get_factory_proc_address(module: windows::Win32::Foundation::HMODULE) -> Option<unsafe extern "system" fn() -> *mut c_void> {
    unsafe {
        let _name = std::ffi::CString::new("GetPluginFactory").unwrap();
        let proc = GetProcAddress(module, s!("GetPluginFactory"));
        
        if let Some(proc) = proc {
             std::mem::transmute(proc)
        } else {
             None
        }
    }
}

unsafe fn try_init_dll(module: windows::Win32::Foundation::HMODULE) -> bool {
    let proc = GetProcAddress(module, s!("InitDll"));
    if let Some(proc) = proc {
         println!("[Native] Found InitDll. Calling...");
         let init_dll: unsafe extern "system" fn() -> bool = std::mem::transmute(proc);
         let result = init_dll();
         println!("[Native] InitDll returned: {}", result);
         return result;
    }
    true // Not found means success/not needed
}

unsafe fn try_exit_dll(lib_handle: windows::Win32::Foundation::HMODULE) -> bool {
    let exit_dll_name = s!("ExitDll");
    let exit_proc_addr = GetProcAddress(lib_handle, exit_dll_name);
    
    if exit_proc_addr.is_none() {
        return true; // Not required
    }
    
    let exit_proc: unsafe extern "system" fn() -> bool = std::mem::transmute(exit_proc_addr);
    let result = exit_proc();
    println!("[Native] ExitDll returned: {}", result);
    result
}

unsafe extern "system" fn wnd_proc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    match msg {
        WM_CLOSE => {
             println!("[Native] wnd_proc: WM_CLOSE received. Hiding Window instead of Destroying...");
             windows::Win32::UI::WindowsAndMessaging::ShowWindow(hwnd, windows::Win32::UI::WindowsAndMessaging::SW_HIDE);
             LRESULT(0)
        }
        WM_DESTROY => {
            println!("[Native] wnd_proc: WM_DESTROY received.");
            use windows::Win32::System::Threading::GetCurrentThreadId;
            use windows::Win32::UI::WindowsAndMessaging::PostThreadMessageW;
            PostThreadMessageW(GetCurrentThreadId(), WM_VST_DROP_INSTANCE, WPARAM(hwnd.0 as usize), LPARAM(0));
            LRESULT(0)
        }
        WM_SIZE => {
            let ptr_val = GetWindowLongPtrW(hwnd, GWLP_USERDATA);
            // SIZE_MINIMIZED は 1。最小化時はOnSizeをスキップしてクラッシュを防ぐ。
            if ptr_val != 0 && wparam.0 != 1 {
                let view_interface_ptr = ptr_val as *mut *mut <dyn IPlugView as ComInterface>::VTable;
                 let vptr = &**view_interface_ptr;

                let mut rect = RECT::default();
                windows::Win32::UI::WindowsAndMessaging::GetClientRect(hwnd, &mut rect);
                
                let mut view_rect = ViewRect {
                    left: rect.left,
                    top: rect.top,
                    right: rect.right,
                    bottom: rect.bottom,
                };
                // println!("[Native] Valid View found. Resizing to {}x{}", rect.right, rect.bottom);
                match (vptr.OnSize)(view_interface_ptr as *mut _, &mut view_rect) {
                    kResultOk => {}, // println!("[Native] onSize success."),
                    _ => {}, // println!("[Native] onSize failed/unsupported."),
                }
            }
            DefWindowProcW(hwnd, msg, wparam, lparam)
        }
        _ => DefWindowProcW(hwnd, msg, wparam, lparam),
    }
}

impl Drop for VstInstance {
    fn drop(&mut self) {
        println!("[Native] VstInstance Dropping... Cleaning up resources.");
        unsafe {
            if let Some(component) = self.component.take() {
                // 1. Deactivate
                println!("[Native] Deactivating component...");
                component.set_active(0);
                
                // 2. Remove View
                if let Some(v) = self.view.take() {
                    println!("[Native] Removing view...");
                    v.removed();
                }
                
                if let Some(edit_controller) = self.edit_controller.take() {
                    let has_separate_controller = component.as_ptr() as *mut c_void != edit_controller.as_ptr() as *mut c_void;
                    if has_separate_controller {
                         println!("[Native] Terminating EditController...");
                         edit_controller.terminate();
                    }
                }
                
                // 4. Terminate Component
                println!("[Native] Terminating Component...");
                component.terminate();
            }

            // Drop factory before FreeLibrary
            let _ = self.factory.take();
            
            // 5. RefCounted ExitDll
            let mut should_exit = false;
            {
                let mut map = LOADED_LIBRARIES.lock().unwrap();
                let handle_val = self.lib_handle.0 as isize;
                if let Some(count) = map.get_mut(&handle_val) {
                     if *count > 0 {
                         *count -= 1;
                         println!("[Native] Library RefCount decremented to: {}", *count);
                         if *count == 0 {
                             should_exit = true;
                             map.remove(&handle_val);
                         }
                     }
                }
            }
            
            if self.hwnd.0 != 0 {
                println!("[Native] Destroying VST Window...");
                windows::Win32::UI::WindowsAndMessaging::DestroyWindow(self.hwnd);
            }
            
            if should_exit {
                println!("[Native] Exiting DLL (Last Instance)...");
                if !try_exit_dll(self.lib_handle) { println!("[Native] Warning: ExitDll returned false."); }
                
                 // Unload Library
                println!("[Native] Skipping FreeLibrary to prevent STATUS_ACCESS_VIOLATION.");
                // #[link(name = "kernel32")]
                // extern "system" {
                //     fn FreeLibrary(hLibModule: isize) -> i32;
                // }
                // FreeLibrary(self.lib_handle.0);
                // println!("[Native] Library Unloaded.");
            }
        }
        println!("[Native] VstInstance Drop Complete.");
    }
}


pub fn send_midi(vst_id: u32, status: u8, data1: u8, data2: u8) -> Result<(), String> {
    let coord_lock = COORDINATOR.lock().unwrap();
    if let Some(coordinator) = coord_lock.as_ref() {
        coordinator.tx.send(VstCommand::Midi(vst_id, status, data1, data2)).map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("Coordinator not running. VST must be loaded first.".to_string())
    }
}

pub fn get_audio(vst_id: u32, req_samples: usize) -> Result<(Vec<f32>, Vec<f32>), String> {
    let coord_lock = COORDINATOR.lock().unwrap();
    if let Some(coordinator) = coord_lock.as_ref() {
        let (tx, rx) = std::sync::mpsc::channel();
        coordinator.tx.send(VstCommand::GetAudio(vst_id, req_samples, tx)).map_err(|e| e.to_string())?;
        loop {
            match rx.recv_timeout(std::time::Duration::from_millis(50)) {
                Ok(result) => return result,
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => { continue; },
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => return Err("GetAudio channel disconnected".to_string()),
            }
        }
    } else {
        Err("Coordinator not running. VST must be loaded first.".to_string())
    }
}

pub fn process_audio(vst_id: u32, req_samples: usize, in_l: Vec<f32>, in_r: Vec<f32>) -> Result<(Vec<f32>, Vec<f32>), String> {
    let coord_lock = COORDINATOR.lock().unwrap();
    if let Some(coordinator) = coord_lock.as_ref() {
        let (tx, rx) = std::sync::mpsc::channel();
        coordinator.tx.send(VstCommand::ProcessAudio(vst_id, req_samples, in_l, in_r, tx)).map_err(|e| e.to_string())?;
        loop {
            match rx.recv_timeout(std::time::Duration::from_millis(50)) {
                Ok(result) => return result,
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => { continue; },
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => return Err("ProcessAudio channel disconnected".to_string()),
            }
        }
    } else {
        Err("Coordinator not running. VST must be loaded first.".to_string())
    }
}

pub fn close_editor(vst_id: u32) -> Result<(), String> {
    let coord_lock = COORDINATOR.lock().unwrap();
    if let Some(coordinator) = coord_lock.as_ref() {
        coordinator.tx.send(VstCommand::Close(vst_id)).map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("Coordinator not running. VST must be loaded first.".to_string())
    }
}

pub fn show_window(vst_id: u32) -> Result<(), String> {
    let coord_lock = COORDINATOR.lock().unwrap();
    if let Some(coordinator) = coord_lock.as_ref() {
        coordinator.tx.send(VstCommand::Show(vst_id)).map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("Coordinator not running. VST must be loaded first.".to_string())
    }
}
