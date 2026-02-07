use std::ffi::{c_void, c_char};
use std::sync::atomic::{AtomicI32, Ordering};
use std::sync::mpsc::channel;
use std::thread;

use vst3_sys::base::{kResultOk, IPluginFactory, kNoInterface, IPluginBase, IUnknown, tresult, TBool, kNotImplemented};
use vst3_sys::vst::{
    IComponent, IEditController, IHostApplication, IComponentHandler, ParamID, ParamValue
};
use vst3_sys::gui::{IPlugView, ViewRect, IPlugFrame}; 

use vst3_com::{IID, VstPtr, ComInterface};
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM, RECT};
use windows::Win32::System::LibraryLoader::{GetModuleHandleW, LoadLibraryW, GetProcAddress};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW, LoadCursorW,
    PostQuitMessage, RegisterClassW, TranslateMessage, CS_HREDRAW, CS_VREDRAW,
    CW_USEDEFAULT, IDC_ARROW, MSG, WINDOW_EX_STYLE,
    WM_DESTROY, WM_SIZE, WNDCLASSW, WS_OVERLAPPEDWINDOW,
    AdjustWindowRect, SetWindowLongPtrW, GetWindowLongPtrW, GWLP_USERDATA,
    SetWindowPos, SWP_NOMOVE, SWP_NOZORDER, SWP_NOACTIVATE, SW_SHOW, SetTimer, ShowWindow
};
use windows::Win32::System::Com::{CoInitializeEx, COINIT_APARTMENTTHREADED, CoUninitialize};
use windows::core::{PCWSTR, s, w};

// --- Interfaces Implementation ---

// --- Unified Host Implementation ---

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

// ----------------------------------------

#[repr(C)]
struct UnifiedHost {
    pub vptr_host: *const IHostApplicationVTableLayout,
    pub vptr_handler1: *const IComponentHandlerVTableLayout,
    pub vptr_handler2: *const IComponentHandler2VTableLayout,
    pub vptr_handler3: *const IComponentHandler3VTableLayout,
    ref_count: AtomicI32,
}

// IComponentHandler3 Methods
unsafe extern "system" fn ComponentHandler3_create_context_menu(_this: *mut c_void, _plug_view: *mut c_void, _flags: *const i32) -> *mut c_void {
    println!("[Native] ComponentHandler::create_context_menu called. Not Implemented.");
    use std::io::Write;
    let _ = std::io::stdout().flush();
    std::ptr::null_mut() // Return NULL for now (Host fails to create menu)
}

static HOST_VTBL: IHostApplicationVTableLayout = IHostApplicationVTableLayout {
    query_interface: UnifiedHost_query_interface,
    add_ref: UnifiedHost_add_ref,
    release: UnifiedHost_release,
    get_name: HostApplication_get_name, // Reuse existing impl
    create_instance: HostApplication_create_instance, // Reuse existing impl
};

static HANDLER1_VTBL: IComponentHandlerVTableLayout = IComponentHandlerVTableLayout {
    query_interface: UnifiedHandler_query_interface1,
    add_ref: UnifiedHandler_add_ref1,
    release: UnifiedHandler_release1,
    begin_edit: ComponentHandler_begin_edit, // Reuse existing impl
    perform_edit: ComponentHandler_perform_edit, // Reuse existing impl
    end_edit: ComponentHandler_end_edit, // Reuse existing impl
    restart_component: ComponentHandler_restart_component, // Reuse existing impl
};

static HANDLER2_VTBL: IComponentHandler2VTableLayout = IComponentHandler2VTableLayout {
    query_interface: UnifiedHandler_query_interface2,
    add_ref: UnifiedHandler_add_ref2,
    release: UnifiedHandler_release2,
    begin_edit: ComponentHandler_begin_edit,
    perform_edit: ComponentHandler_perform_edit,
    end_edit: ComponentHandler_end_edit,
    restart_component: ComponentHandler_restart_component,
    set_dirty: ComponentHandler_set_dirty, // Reuse existing impl
    request_open_editor: ComponentHandler_request_open_editor, // Reuse existing impl
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
    create_context_menu: ComponentHandler3_create_context_menu,
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

unsafe extern "system" fn HostApplication_create_instance(_this: *mut c_void, cid: *const IID, _iid: *const IID, _obj: *mut *mut c_void) -> i32 {
    let cid_val = *cid;
    println!("[Native] HostApplication::create_instance called. CID: {:08X}-{:04X}-{:04X}-{:02X}{:02X}{:02X}{:02X}{:02X}{:02X}{:02X}{:02X}", 
        cid_val.data[0] as u32 | ((cid_val.data[1] as u32) << 8) | ((cid_val.data[2] as u32) << 16) | ((cid_val.data[3] as u32) << 24),
        cid_val.data[4] as u16 | ((cid_val.data[5] as u16) << 8),
        cid_val.data[6] as u16 | ((cid_val.data[7] as u16) << 8),
        cid_val.data[8], cid_val.data[9], cid_val.data[10], cid_val.data[11],
        cid_val.data[12], cid_val.data[13], cid_val.data[14], cid_val.data[15]);
    
    // Check if it's IMessage, IAttributeList, etc.
    // For now returning Not Implemented
    kNotImplemented
}

// IComponentHandler Methods
unsafe extern "system" fn ComponentHandler_begin_edit(_this: *mut c_void, _id: ParamID) -> tresult { 
    // println!("[Native] ComponentHandler::begin_edit id={}", _id);
    kResultOk 
}
unsafe extern "system" fn ComponentHandler_perform_edit(_this: *mut c_void, _id: ParamID, _val: ParamValue) -> tresult { kResultOk }
unsafe extern "system" fn ComponentHandler_end_edit(_this: *mut c_void, _id: ParamID) -> tresult { kResultOk }
unsafe extern "system" fn ComponentHandler_restart_component(_this: *mut c_void, flags: i32) -> tresult {
    println!("[Native] ComponentHandler::restart_component flags={}", flags);
    use std::io::Write;
    let _ = std::io::stdout().flush();
    // Flags: 1=Reload, 2=IoChanged, 4=ParamValuesChanged, 8=LatencyChanged, 16=ProcessingPrecisionChanged
    kResultOk
}

// IComponentHandler2 Methods
unsafe extern "system" fn ComponentHandler_set_dirty(_this: *mut c_void, state: TBool) -> tresult { 
    println!("[Native] ComponentHandler2::set_dirty state={}", state);
    kResultOk 
}
unsafe extern "system" fn ComponentHandler_request_open_editor(_this: *mut c_void, _name: *const c_char) -> tresult { 
    println!("[Native] ComponentHandler2::request_open_editor");
    kResultOk 
}
unsafe extern "system" fn ComponentHandler_start_group_edit(_this: *mut c_void) -> tresult {
    println!("[Native] ComponentHandler2::start_group_edit");
    kResultOk
}
unsafe extern "system" fn ComponentHandler_finish_group_edit(_this: *mut c_void) -> tresult {
    println!("[Native] ComponentHandler2::finish_group_edit");
    kResultOk
}

// --- PlugFrame Implementation ---
#[repr(C)]
struct PlugFrame {
    pub vptr: *const IPlugFrameVTableLayout,
    ref_count: AtomicI32,
    hwnd: HWND,
}
#[repr(C)]
struct IPlugFrameVTableLayout {
    pub query_interface: unsafe extern "system" fn(*mut c_void, *const IID, *mut *mut c_void) -> tresult,
    pub add_ref: unsafe extern "system" fn(*mut c_void) -> u32,
    pub release: unsafe extern "system" fn(*mut c_void) -> u32,
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

// --- Main Exported Function ---

pub fn load_and_open(path: String) -> Result<(), String> {
    let (tx, rx) = channel();

    thread::spawn(move || {
        let res = unsafe { run_vst_thread(&path, tx.clone()) };
        if let Err(e) = res {
            println!("[Native] Thread Error: {}", e);
            let _ = tx.send(Err(e));
        }
    });

    rx.recv().map_err(|e| format!("Receive error: {}", e))?
}

unsafe fn run_vst_thread(path: &str, tx: std::sync::mpsc::Sender<Result<(), String>>) -> Result<(), String> {
    CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok();

    println!("[Native] Thread started.");
    
    // 1. Create Window Class & Window
    let instance = GetModuleHandleW(None).unwrap();
    let class_name = w!("DAWIY_VST_HOST");

    let wc = WNDCLASSW {
        hInstance: instance.into(),
        lpszClassName: class_name,
        lpfnWndProc: Some(wnd_proc),
        style: CS_HREDRAW | CS_VREDRAW,
        hCursor: LoadCursorW(None, IDC_ARROW).unwrap(),
        ..Default::default()
    };
    RegisterClassW(&wc);
    
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
    
    // 2. Load Plugin
    let path_os: Vec<u16> = std::path::Path::new(path)
        .as_os_str().encode_wide().chain(std::iter::once(0)).collect();
    let lib_handle = LoadLibraryW(PCWSTR(path_os.as_ptr()))
        .map_err(|e| format!("Failed to load DLL: {:?}", e))?;

    let get_factory_name = s!("GetPluginFactory");
    let get_factory_proc = GetProcAddress(lib_handle, get_factory_name);
    if get_factory_proc.is_none() { 
        return Err("No factory".into());
    }

    let get_factory: unsafe extern "system" fn() -> *mut c_void = std::mem::transmute(get_factory_proc.unwrap());
    let factory_raw = get_factory();
    let factory = VstPtr::<dyn IPluginFactory>::owned(factory_raw as *mut *mut _).unwrap();

    let factory_ptr = factory_raw as *mut *mut <dyn IPluginFactory as ComInterface>::VTable;
    let factory_vtbl = &**factory_ptr;
    let this_ptr = factory_ptr as *mut *const <dyn IPluginFactory as ComInterface>::VTable;
    
    let count = (factory_vtbl.CountClasses)(this_ptr);
    println!("[Native] Class count: {}", count);
    
    let mut component_uid: Option<IID> = None;
    for i in 0..count {
            let mut info = std::mem::zeroed::<vst3_sys::base::PClassInfo>();
            if (factory_vtbl.GetClassInfo)(this_ptr, i, &mut info) == kResultOk {
                let name_u16: Vec<u16> = info.name.iter().map(|&c| c as u16).take_while(|c| *c != 0).collect();
                let name = String::from_utf16_lossy(&name_u16);
                let cat_u16: Vec<u16> = info.category.iter().map(|&c| c as u16).take_while(|c| *c != 0).collect();
                let category = String::from_utf16_lossy(&cat_u16);
                
                println!("[Native] Class {}: {}, Category: {}", i, name, category);
                // Naive check: just take first one or look for Audio Module
                component_uid = Some(info.cid); 
                break;
            }
    }
    
    if component_uid.is_none() { return Err("No component found".into()); }
    let cid = component_uid.unwrap();
    
    let mut component_ptr: *mut c_void = std::ptr::null_mut();
    let i_component_iid = <dyn IComponent as ComInterface>::IID; 
    // Message Pump Helper
    unsafe fn pump_messages() {
        use windows::Win32::UI::WindowsAndMessaging::{PeekMessageW, DispatchMessageW, TranslateMessage, PM_REMOVE, MSG};
        let mut msg = MSG::default();
        // Pump until queue is empty
        while PeekMessageW(&mut msg, None, 0, 0, PM_REMOVE).as_bool() {
             let _ = TranslateMessage(&msg);
             let _ = DispatchMessageW(&msg);
        }
    }

    // 1. Initialize Component
    println!("[Native] Creating component...");
    if (factory_vtbl.CreateInstance)(this_ptr, &cid, &i_component_iid, &mut component_ptr) != kResultOk {
            return Err("Failed to create component".into());
    }
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

    // --- Audio Bus Initialization (Critical for Vital) ---
    // --- Audio Bus Initialization (Critical for Vital) ---
    // 1. Get IAudioProcessor
    use vst3_sys::vst::{SpeakerArrangement, IAudioProcessor, BusDirections, MediaTypes, ProcessSetup, ProcessModes, SymbolicSampleSizes};
    let processor_iid = <dyn IAudioProcessor as ComInterface>::IID;
    let mut processor_ptr: *mut c_void = std::ptr::null_mut();
    if component.query_interface(&processor_iid, &mut processor_ptr) == kResultOk {
        println!("[Native] IAudioProcessor interface obtained.");
        let processor = VstPtr::<dyn IAudioProcessor>::owned(processor_ptr as *mut *mut _).unwrap();
        
        // 1.5 Setup Processing (Critical for Audio Engine)
        let setup = ProcessSetup {
            process_mode: ProcessModes::kRealtime as i32,
            symbolic_sample_size: SymbolicSampleSizes::kSample32 as i32,
            max_samples_per_block: 512,
            sample_rate: 44100.0,
        };
        println!("[Native] Setting up processing (SR=44100, Block=512)...");
        if processor.setup_processing(&setup) == kResultOk {
             println!("[Native] Processing setup successful.");
        } else {
             println!("[Native] Failed to setup processing.");
        }

        // 2. Set Bus Arrangements (Stereo Out, No In)
        // Stereo = kSpeakerL | kSpeakerR = 1 | 2 = 3
        let mut input_speaker: SpeakerArrangement = 0; // No input
        let mut output_speaker: SpeakerArrangement = 3; // Stereo (L+R)
        
        println!("[Native] Setting Bus Arrangements to Stereo...");
        if processor.set_bus_arrangements(&mut input_speaker, 0, &mut output_speaker, 1) == kResultOk {
             println!("[Native] Bus Arrangement set successfully.");
        } else {
             println!("[Native] Failed to set Bus Arrangement (might not be supported or needed).");
        }
    } else {
        println!("[Native] Failed to get IAudioProcessor.");
    }
    unsafe { pump_messages(); } // Pump after Bus Init

    // 3. Activate Bus (Moved to later)
    // println!("[Native] Activating Output Bus 0...");
    // if component.activate_bus(MediaTypes::kAudio as i32, BusDirections::kOutput as i32, 0, 1) != kResultOk {
    //      println!("[Native] Failed to activate output bus.");
    // }

    // Activate Bus AFTER State Sync? (Try restoring here)
    println!("[Native] Activating Output Bus 0 (Delayed)...");
    if component.activate_bus(MediaTypes::kAudio as i32, BusDirections::kOutput as i32, 0, 1) != kResultOk {
         println!("[Native] Failed to activate output bus.");
    }

    // 4. Set Active (Must be active for some operations, but inactive for setComponentState)
    // Vital seems to need activation to report parameters? 
    // BUT Spec says: "The host must un-activate the component before setComponentState is called."
    // Let's try sticking to spec for State Sync, but if it fails, we activate and then scan.
    
    // ... Controller Creation ...
    let mut edit_controller: Option<VstPtr<dyn IEditController>> = None;
    let mut controller_iid: IID = std::mem::zeroed();

    // Create Handler early for Controller Init -> Now we use Unified Host!
    // But initialize(host_app) is what we want.
    // host_app implements IHostApplication AND IComponentHandler.
    // So passing host_app should work if queryinterface is correct.
    
    // HOWEVER, IComponentHandler interface pointer is NOT 'host_app' primitive pointer (which is IHostApplication vtable).
    // The Controller will query interface on host_app.
    // Our query_interface handles it perfectly.
    
    // But wait, create_component_handler logic removed.
    // We should pass host_app to initialize.

    println!("[Native] Checking for separate controller...");
    if component.get_controller_class_id(&mut controller_iid) == kResultOk {
        println!("[Native] Has separate controller class.");
        let mut controller_ptr: *mut c_void = std::ptr::null_mut();
        let i_edit_iid = <dyn IEditController as ComInterface>::IID;
        if (factory_vtbl.CreateInstance)(this_ptr, &controller_iid, &i_edit_iid, &mut controller_ptr) == kResultOk && !controller_ptr.is_null() {
                let controller = VstPtr::<dyn IEditController>::owned(controller_ptr as *mut *mut _).unwrap();
                println!("[Native] Separate Controller created.");
                // Pass unified host app!
                if controller.initialize(host_app as *mut c_void) == kResultOk {
                    edit_controller = Some(controller);
                    println!("[Native] Separate Controller initialized with Unified Host.");
                } else {
                    println!("[Native] Separate Controller init failed.");
                }
        } else {
            println!("[Native] Failed to create separate controller instance.");
        }
    }
    
    if edit_controller.is_none() {
        println!("[Native] Querying Component for IEditController...");
        let mut edit_controller_ptr: *mut c_void = std::ptr::null_mut();
        let i_edit_iid = <dyn IEditController as ComInterface>::IID;
        if component.query_interface(&i_edit_iid, &mut edit_controller_ptr) == kResultOk {
                edit_controller = VstPtr::<dyn IEditController>::owned(edit_controller_ptr as *mut *mut _);
                println!("[Native] Component IS EditController.");
        }
    }
    
    if edit_controller.is_none() {
        return Err("No controller found".into());
    }
    let edit_controller = edit_controller.unwrap();
    
    // ... (previous code)

    // Set Component Handler
    // For set_component_handler, we need IComponentHandler interface pointer.
    // This is host_app + 8 bytes!
    let handler_ptr = (host_app as *mut u8).add(8) as *mut c_void;
    
    // We must ensure the object stays alive. host_app is managed by Box::from_raw/into_raw manual ref counting?
    // Current create_unified_host returns into_raw (leaked box). RefCount 1.
    // set_component_handler takes SharedVstPtr.
    // We can cast handler_ptr to SharedVstPtr.
    
    let handler_arg: vst3_sys::utils::SharedVstPtr<dyn IComponentHandler> = std::mem::transmute(handler_ptr);
    edit_controller.set_component_handler(handler_arg);
    // Note: set_component_handler likely calls AddRef on the handler interface.
    // Our UnifiedHandler_add_ref1 calls unified_add_ref on the main object.
    // Correct.
    // ...
    println!("[Native] Component Handler set.");
     
     // Check extra interfaces for Debugging
     use vst3_sys::vst::{IUnitInfo, IEditController2, IMidiMapping, IEditControllerHostEditing, UnitInfo};
     
     // 1. Check if Component ALSO implements IEditController (Just to know)
     let mut test_ptr: *mut c_void = std::ptr::null_mut();
     if component.query_interface(&<dyn IEditController as ComInterface>::IID, &mut test_ptr) == kResultOk {
         println!("[Native] INFO: Component ALSO implements IEditController.");
     } else {
         println!("[Native] INFO: Component does NOT implement IEditController.");
     }

     // 2. Unit Info Details
     let mut unit_info_ptr: *mut c_void = std::ptr::null_mut();
     if edit_controller.query_interface(&<dyn IUnitInfo as ComInterface>::IID, &mut unit_info_ptr) == kResultOk {
          println!("[Native] Controller supports IUnitInfo.");
          let unit_info = VstPtr::<dyn IUnitInfo>::owned(unit_info_ptr as *mut *mut _).unwrap();
          let u_count = unit_info.get_unit_count();
          println!("[Native] Unit Count: {}", u_count);
          println!("[Native] Program List Count: {}", unit_info.get_program_list_count());
          
          if u_count > 0 {
              let mut info = std::mem::zeroed::<UnitInfo>();
              if unit_info.get_unit_info(0, &mut info) == kResultOk {
                   let name_u16: Vec<u16> = info.name.iter().map(|&c| c as u16).take_while(|c| *c != 0).collect();
                   let name = String::from_utf16_lossy(&name_u16);
                   println!("[Native] Unit 0 Name: {}", name);
              }
          }
     } else {
          println!("[Native] Controller does NOT support IUnitInfo.");
     }
     
     // 3. MIDI Mapping Check
     let mut midi_ptr: *mut c_void = std::ptr::null_mut();
     if edit_controller.query_interface(&<dyn IMidiMapping as ComInterface>::IID, &mut midi_ptr) == kResultOk {
          println!("[Native] Controller supports IMidiMapping.");
     }
     
     // 4. EditControllerHostEditing Check
     let mut host_edit_ptr: *mut c_void = std::ptr::null_mut();
     if edit_controller.query_interface(&<dyn IEditControllerHostEditing as ComInterface>::IID, &mut host_edit_ptr) == kResultOk {
          println!("[Native] Controller supports IEditControllerHostEditing.");
     }
     let mut edit2_ptr: *mut c_void = std::ptr::null_mut();
     if edit_controller.query_interface(&<dyn IEditController2 as ComInterface>::IID, &mut edit2_ptr) == kResultOk {
          println!("[Native] Controller supports IEditController2.");
     } else {
          println!("[Native] Controller does NOT support IEditController2.");
     }

    println!("[Native] Attempting ConnectionPoint Handshake...");
    let mut comp_cp_ptr: *mut c_void = std::ptr::null_mut();
    let mut ctrl_cp_ptr: *mut c_void = std::ptr::null_mut();
    // QueryInterface calls...
    // QueryInterface calls...
    let res_comp = component.query_interface(&IID_ICONNECTIONPOINT, &mut comp_cp_ptr);
    let res_ctrl = edit_controller.query_interface(&IID_ICONNECTIONPOINT, &mut ctrl_cp_ptr);
    use std::io::Write; // Import Write trait
    let _ = std::io::stdout().flush();



    // START DEBUG SKIP: Force DISABLE State Synchronization
    // let skip_state_sync = false; // Reverted to false for normal operation

    // Original Logic Restored
    if res_comp == kResultOk && res_ctrl == kResultOk && !comp_cp_ptr.is_null() && !ctrl_cp_ptr.is_null() {
             println!("[Native] Both support IConnectionPoint. Connecting...");
             let _ = std::io::stdout().flush();
             
             let comp_cp = VstPtr::<dyn IConnectionPoint>::owned(comp_cp_ptr as *mut *mut _).unwrap();
             let ctrl_cp = VstPtr::<dyn IConnectionPoint>::owned(ctrl_cp_ptr as *mut *mut _).unwrap();
     
             // Connect Component to Controller (Manual VTable Dispatch)
             unsafe {
                 let this_comp = comp_cp.as_ptr() as *mut c_void;
                 let vptr_comp = *(this_comp as *mut *const IConnectionPointVTable);
                 let res_conn1 = ((*vptr_comp).connect)(this_comp, ctrl_cp.as_ptr() as *mut c_void);
                 println!("[Native] IConnectionPoint::Connect (Comp->Ctrl) Result: {}", res_conn1);

                 let this_ctrl = ctrl_cp.as_ptr() as *mut c_void;
                 let vptr_ctrl = *(this_ctrl as *mut *const IConnectionPointVTable);
                 let res_conn2 = ((*vptr_ctrl).connect)(this_ctrl, comp_cp.as_ptr() as *mut c_void);
                 println!("[Native] IConnectionPoint::Connect (Ctrl->Comp) Result: {}", res_conn2);
             }
             
             println!("[Native] Connected.");
             let _ = std::io::stdout().flush();
             // VstPtr will release on drop, which is correct because query_interface adds ref.
    } else {
             println!("[Native] ConnectionPoint Handshake Failed or Unsupported (Comp: {:?}/{}, Ctrl: {:?}/{}).", res_comp, !comp_cp_ptr.is_null(), res_ctrl, !ctrl_cp_ptr.is_null());
             println!("[Native] Fallback: State Synchronization via IBStream...");
             let _ = std::io::stdout().flush();
             
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
            data: std::cell::RefCell<Vec<u8>>,
            cursor: std::cell::Cell<usize>,
        }
        
        unsafe extern "system" fn stream_query_interface(this: *mut c_void, iid: *const IID, obj: *mut *mut c_void) -> i32 {
            use std::io::Write;
            let check = *iid;
            let iid_guid = format!("{:?}", check); 
            println!("[Native] IBStream::QueryInterface IID: {}", iid_guid);
            let _ = std::io::stdout().flush();
            
            // IID_IBStream OR IUnknown
            if check == <dyn IUnknown as ComInterface>::IID {
                 println!("[Native] IBStream::QueryInterface -> IUnknown matched.");
                 let _ = std::io::stdout().flush();
                 *obj = this;
                 stream_add_ref(this);
                 return kResultOk;
            }
             let iid_ibstream = <dyn vst3_sys::base::IBStream as ComInterface>::IID;
             if check == iid_ibstream {
                 println!("[Native] IBStream::QueryInterface -> IBStream matched.");
                 let _ = std::io::stdout().flush();
                 *obj = this;
                 stream_add_ref(this);
                 return kResultOk;
             }
             
             // ISizeableStream check
             let iid_isizeablestream = IID { data: [0xE2, 0x93, 0xD4, 0x6C, 0x5D, 0x05, 0xCB, 0x47, 0x91, 0xA4, 0xDE, 0x48, 0x60, 0x92, 0xFF, 0x76] };
             if check == iid_isizeablestream { // 6CD493E2...
                  println!("[Native] IBStream::QueryInterface -> ISizeableStream matched.");
                  let _ = std::io::stdout().flush();
                  *obj = this;
                  stream_add_ref(this);
                  return kResultOk;
             }

            println!("[Native] IBStream::QueryInterface Unknown IID: {:?}", check);
            let _ = std::io::stdout().flush();
            kNoInterface
        }
        unsafe extern "system" fn stream_add_ref(this: *mut c_void) -> u32 {
            let s = &*(this as *const HostMemoryStream);
            let c = s.ref_count.fetch_add(1, Ordering::Relaxed) as u32 + 1;
            // use std::io::Write;
            // println!("[Native] IBStream::add_ref -> {}", c);
            // let _ = std::io::stdout().flush();
            c
        }
        unsafe extern "system" fn stream_release(this: *mut c_void) -> u32 {
            let s = &*(this as *const HostMemoryStream);
            let val = s.ref_count.fetch_sub(1, Ordering::Relaxed);
            let c = val as u32 - 1;
            // use std::io::Write;
            // println!("[Native] IBStream::release -> {}", c);
            // let _ = std::io::stdout().flush();
            if val == 1 {
                let _ = Box::from_raw(this as *mut HostMemoryStream);
            }
            c
        }
        unsafe extern "system" fn stream_read(this: *mut c_void, buffer: *mut c_void, num_bytes: i32, num_bytes_read: *mut i32) -> tresult {
             use std::io::Write;
             let s = &*(this as *const HostMemoryStream);
             let data = s.data.borrow();
             let cursor = s.cursor.get();
             
             let available = data.len().saturating_sub(cursor);
             let to_read = std::cmp::min(available, num_bytes as usize);
             
             println!("[Native] IBStream::read req={} avail={} cursor={} len={} -> reading {}", num_bytes, available, cursor, data.len(), to_read);
             let _ = std::io::stdout().flush();
             
             if to_read > 0 {
                std::ptr::copy_nonoverlapping(data.as_ptr().add(cursor), buffer as *mut u8, to_read);
                s.cursor.set(cursor + to_read);
             }
             
             if !num_bytes_read.is_null() {
                 *num_bytes_read = to_read as i32;
             }
             
             kResultOk
        }

        unsafe extern "system" fn stream_write(this: *mut c_void, buffer: *mut c_void, num_bytes: i32, num_bytes_written: *mut i32) -> tresult {
             println!("[Native] IBStream::write req={}", num_bytes);
             use std::io::Write;
             let _ = std::io::stdout().flush();
             let s = &*(this as *const HostMemoryStream);
             let mut data = s.data.borrow_mut();
             let cursor = s.cursor.get();
             
             let required_len = cursor + num_bytes as usize;
             if required_len > data.len() {
                 data.resize(required_len, 0);
             }
             
             std::ptr::copy_nonoverlapping(buffer as *const u8, data.as_mut_ptr().add(cursor), num_bytes as usize);
             s.cursor.set(cursor + num_bytes as usize);
             
             if !num_bytes_written.is_null() {
                 *num_bytes_written = num_bytes as i32;
             }
             kResultOk
        }

        unsafe extern "system" fn stream_seek(this: *mut c_void, pos: i64, mode: i32, result: *mut i64) -> tresult {
            use std::io::Write;
            let s = &*(this as *const HostMemoryStream);
            let current = s.cursor.get() as i64;
            let len = s.data.borrow().len() as i64;
            
            let new_pos = match mode {
                0 => pos, // SeekSet
                1 => current + pos, // SeekCur
                2 => len + pos, // SeekEnd
                _ => return -1, // kInvalidArgument
            };
            
            println!("[Native] IBStream::seek mode={} pos={} (cur={} len={}) -> new_pos={}", mode, pos, current, len, new_pos);
            let _ = std::io::stdout().flush();

            if new_pos < 0 || new_pos > len {
                println!("[Native] IBStream::seek INVALID POSITION");
                return -1; // Error
            }
            s.cursor.set(new_pos as usize);
            if !result.is_null() {
                *result = new_pos;
            }
            kResultOk
        }
        unsafe extern "system" fn stream_tell(this: *mut c_void, result: *mut i64) -> tresult {
            let s = &*(this as *const HostMemoryStream);
            if !result.is_null() {
                *result = s.cursor.get() as i64;
            }
            kResultOk
        }

        unsafe extern "system" fn stream_get_stream_size(this: *mut c_void, size: *mut i64) -> tresult {
            let s = &*(this as *const HostMemoryStream);
            let len = s.data.borrow().len() as i64;
            println!("[Native] ISizeableStream::get_stream_size -> {}", len);
            use std::io::Write;
            let _ = std::io::stdout().flush();
            if !size.is_null() {
                *size = len;
            }
            kResultOk
        }
        
        unsafe extern "system" fn stream_set_stream_size(_this: *mut c_void, _size: i64) -> tresult {
            println!("[Native] ISizeableStream::set_stream_size -> Not Implemented (Read Only)");
            kNotImplemented // Or kResultFalse
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
            data: std::cell::RefCell::new(Vec::new()),
            cursor: std::cell::Cell::new(0),
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
             println!("[Native] Read state from component. Size: {} bytes.", (*(stream_ptr as *mut HostMemoryStream)).data.borrow().len());
             
             // Rewind
              (*(stream_ptr as *mut HostMemoryStream)).cursor.set(0);
             
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
                  (*(stream_ptr as *mut HostMemoryStream)).cursor.set(0);
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

    
    // Parameter Scan moved to after activation

    // Activate Component
    println!("[Native] Activating component...");
    let _ = std::io::stdout().flush();
    if component.set_active(1) != kResultOk {
        println!("[Native] WARNING: Failed to activate component.");
    } else {
        println!("[Native] Component activated.");
    }
    unsafe { pump_messages(); } // Pump after Activation

    

    
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


    // Create View
    unsafe { pump_messages(); } // Pump before Create View
    // Try empty name first (Standard)
    println!("[Native] Creating view with name '' (standard)...");
    let mut fs_name = [0u8; 128]; 
    // Just empty string
    
    let mut view_ptr_void = edit_controller.create_view(fs_name.as_ptr() as *const i8);
    let mut view_ptr_void2: *mut c_void = std::ptr::null_mut();
    
    // Fallback to "editor" if empty failed (Unlikely if empty failed, but trying)
    if view_ptr_void.is_null() {
        println!("[Native] '' failed. Trying 'editor'...");
        let editor_s = b"editor\0";
        for (i, &b) in editor_s.iter().enumerate() { fs_name[i] = b; }
        
        // We can't reuse view_ptr_void as it's not mutable in previous scope? 
        // Shadowing
        view_ptr_void2 = edit_controller.create_view(fs_name.as_ptr() as *const i8);
        if !view_ptr_void2.is_null() {
             println!("[Native] 'editor' worked.");
             view_ptr_void = view_ptr_void2;
             println!("[Native] View created with 'editor'.");
        }
    }

    if view_ptr_void.is_null() && view_ptr_void2.is_null() {
        // Fallback: Query IPlugView from EditController directly
        println!("[Native] create_view returned NULL. Trying QueryInterface<IPlugView> on controller...");
        let i_view_iid = <dyn IPlugView as ComInterface>::IID;
        let mut view_ptr_qi: *mut c_void = std::ptr::null_mut();
        if edit_controller.query_interface(&i_view_iid, &mut view_ptr_qi) == kResultOk {
             println!("[Native] Success! Controller implements IPlugView.");
             view_ptr_void = view_ptr_qi; // Treat as if created
        } else {
             println!("[Native] Controller does not implement IPlugView.");
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
    
    // Defer initialization logic
    let mut view: Option<VstPtr<dyn IPlugView>> = None;
    if !view_ptr_void.is_null() {
         view = Some(VstPtr::<dyn IPlugView>::owned(view_ptr_void as *mut *mut _).unwrap());
         println!("[Native] View created immediately.");
    } else {
         println!("[Native] View creation invalid. Entering loop and will retry...");
    }

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
        let plug_frame = create_plug_frame(hwnd);
        v.set_frame(plug_frame);
        let type_hwnd = b"HWND\0".as_ptr() as *const i8;
        v.attached(hwnd.0 as *mut c_void, type_hwnd);
        ShowWindow(hwnd, SW_SHOW);
    }
    
    // Set Timer for retry (every 1000ms)
    SetTimer(hwnd, 1, 1000, None);

    
    tx.send(Ok(())).unwrap_or(()); 

    // Message Loop
    let mut msg = MSG::default();
    loop {
        if GetMessageW(&mut msg, None, 0, 0).as_bool() == false {
            break;
        }
        TranslateMessage(&msg);
        DispatchMessageW(&msg);
        
        // Check Timer manually if Dispatch didn't handle it (it should have)
        // But we need to implement WM_TIMER handling in wnd_proc OR check here?
        // Since we didn't update wnd_proc, let's poll here?
        // No, SetTimer posts WM_TIMER to queue. wnd_proc handles it.
        // I need to update wnd_proc to handle WM_TIMER or use a closure/static state?
        // Wait, local variables (edit_controller, view) are NOT accessible in wnd_proc.
        // This is a Rust closure problem.
        
        // Alternative: Poll in the loop directly using GetTickCount?
        // Or handle message here?
        if msg.message == windows::Win32::UI::WindowsAndMessaging::WM_TIMER {
             println!("[Native] Timer Tick. View exists: {}", view.is_some());
             
             let p_count = edit_controller.get_parameter_count();
             println!("[Native] Periodic Param Check: {}", p_count);
             
             if view.is_none() {
                 println!("[Native] Retrying create_view...");
                 let fs_name = [0u8; 128];
                 let view_ptr_void2 = edit_controller.create_view(fs_name.as_ptr() as *const i8);
                 if !view_ptr_void2.is_null() {
                      println!("[Native] RETRY SUCCESS! View created.");
                      let v = VstPtr::<dyn IPlugView>::owned(view_ptr_void2 as *mut *mut _).unwrap();
                      
                      // Initialization for late view
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

                      let plug_frame = create_plug_frame(hwnd);
                      v.set_frame(plug_frame);
                      let type_hwnd = b"HWND\0".as_ptr() as *const i8;
                      v.attached(hwnd.0 as *mut c_void, type_hwnd);
                      ShowWindow(hwnd, SW_SHOW);
                      
                      view = Some(v);
                 }
             }
        }
    }
    
    if let Some(ref v) = view {
        v.removed();
    }
    SetWindowLongPtrW(hwnd, GWLP_USERDATA, 0);

    drop(view);
    drop(edit_controller);
    component.set_active(0); // Deactivate
    component.terminate();
    drop(component);
    drop(factory);
    
    // Release Handler (manual because we carry raw ptr)
    // But wait, we didn't save it in outer scope easily.
    // Actually, let's just leak it for now to avoid double free crash risk during debug.
    // OS cleans up memory on exit.
    
    CoUninitialize();
    
    Ok(())
}

use std::os::windows::ffi::OsStrExt;

unsafe extern "system" fn wnd_proc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    match msg {
        WM_DESTROY => {
            PostQuitMessage(0);
            LRESULT(0)
        }
        WM_SIZE => {
            let ptr_val = GetWindowLongPtrW(hwnd, GWLP_USERDATA);
            if ptr_val != 0 {
                let view_interface_ptr = ptr_val as *mut *mut <dyn IPlugView as ComInterface>::VTable;
                // vptr extraction logic as before...
                 let vptr = &**view_interface_ptr;

                let mut rect = RECT::default();
                windows::Win32::UI::WindowsAndMessaging::GetClientRect(hwnd, &mut rect);
                
                let mut view_rect = ViewRect {
                    left: rect.left,
                    top: rect.top,
                    right: rect.right,
                    bottom: rect.bottom,
                };
                
                let this_ptr = view_interface_ptr as *mut *const <dyn IPlugView as ComInterface>::VTable;
                (vptr.OnSize)(this_ptr, &mut view_rect);
            }
            DefWindowProcW(hwnd, msg, wparam, lparam)
        }
        _ => DefWindowProcW(hwnd, msg, wparam, lparam),
    }
}
