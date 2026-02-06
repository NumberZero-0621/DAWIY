use std::ffi::c_void;
use std::sync::atomic::{AtomicI32, Ordering};
use std::sync::mpsc::channel;
use std::thread;

use vst3_sys::base::{kResultOk, IPluginFactory, kNoInterface, IPluginBase, IUnknown, tresult};
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
    SetWindowPos, SWP_NOMOVE, SWP_NOZORDER, SWP_NOACTIVATE, SW_SHOW
};
use windows::Win32::System::Com::{CoInitializeEx, COINIT_APARTMENTTHREADED, CoUninitialize};
use windows::core::{PCWSTR, s, w};

// --- Interfaces Implementation ---

#[repr(C)]
struct HostApplication {
    pub vptr: *const IHostApplicationVTableLayout, 
    ref_count: AtomicI32,
}

#[repr(C)]
struct IHostApplicationVTableLayout {
    pub query_interface: unsafe extern "system" fn(*mut c_void, *const IID, *mut *mut c_void) -> i32,
    pub add_ref: unsafe extern "system" fn(*mut c_void) -> u32,
    pub release: unsafe extern "system" fn(*mut c_void) -> u32,
    pub get_name: unsafe extern "system" fn(*mut c_void, *mut u16) -> i32,
    pub create_instance: unsafe extern "system" fn(*mut c_void, *const IID, *const IID, *mut *mut c_void) -> i32,
}

static HOST_APP_VTBL: IHostApplicationVTableLayout = IHostApplicationVTableLayout {
    query_interface: HostApplication_query_interface,
    add_ref: HostApplication_add_ref,
    release: HostApplication_release,
    get_name: HostApplication_get_name,
    create_instance: HostApplication_create_instance,
};

unsafe extern "system" fn HostApplication_query_interface(this: *mut c_void, iid: *const IID, obj: *mut *mut c_void) -> i32 {
    let check = *iid;
    if check == <dyn IUnknown as ComInterface>::IID || check == <dyn IHostApplication as ComInterface>::IID {
        *obj = this;
        HostApplication_add_ref(this);
        return kResultOk;
    }
    kNoInterface
}
unsafe extern "system" fn HostApplication_add_ref(this: *mut c_void) -> u32 {
    let app = &*(this as *const HostApplication);
    app.ref_count.fetch_add(1, Ordering::Relaxed) as u32 + 1
}
unsafe extern "system" fn HostApplication_release(this: *mut c_void) -> u32 {
    let app = &*(this as *const HostApplication);
    let val = app.ref_count.fetch_sub(1, Ordering::Relaxed);
    val as u32 - 1
}
unsafe extern "system" fn HostApplication_get_name(_this: *mut c_void, name: *mut u16) -> i32 {
    let dawiy = "DAWIY".encode_utf16().collect::<Vec<u16>>();
    let dest = std::slice::from_raw_parts_mut(name, 128);
    for (i, &c) in dawiy.iter().enumerate() {
        if i >= 127 { break; }
        dest[i] = c;
    }
    dest[dawiy.len()] = 0;
    kResultOk
}
unsafe extern "system" fn HostApplication_create_instance(_this: *mut c_void, _cid: *const IID, _iid: *const IID, _obj: *mut *mut c_void) -> i32 {
    kNoInterface
}

#[repr(C)]
struct ComponentHandler {
    pub vptr: *const IComponentHandlerVTableLayout,
    ref_count: AtomicI32,
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
static COMP_HANDLER_VTBL: IComponentHandlerVTableLayout = IComponentHandlerVTableLayout {
    query_interface: ComponentHandler_query_interface,
    add_ref: ComponentHandler_add_ref,
    release: ComponentHandler_release,
    begin_edit: ComponentHandler_begin_edit,
    perform_edit: ComponentHandler_perform_edit,
    end_edit: ComponentHandler_end_edit,
    restart_component: ComponentHandler_restart_component,
};
unsafe extern "system" fn ComponentHandler_query_interface(this: *mut c_void, iid: *const IID, obj: *mut *mut c_void) -> i32 {
    if *iid == <dyn IUnknown as ComInterface>::IID || *iid == <dyn IComponentHandler as ComInterface>::IID {
        *obj = this;
        ComponentHandler_add_ref(this);
        return kResultOk;
    }
    kNoInterface
}
unsafe extern "system" fn ComponentHandler_add_ref(this: *mut c_void) -> u32 {
    let h = &*(this as *const ComponentHandler);
    h.ref_count.fetch_add(1, Ordering::Relaxed) as u32 + 1
}
unsafe extern "system" fn ComponentHandler_release(this: *mut c_void) -> u32 {
    let h = &*(this as *const ComponentHandler);
    let val = h.ref_count.fetch_sub(1, Ordering::Relaxed);
    val as u32 - 1
}
unsafe extern "system" fn ComponentHandler_begin_edit(_this: *mut c_void, _id: ParamID) -> tresult { kResultOk }
unsafe extern "system" fn ComponentHandler_perform_edit(_this: *mut c_void, _id: ParamID, _val: ParamValue) -> tresult { kResultOk }
unsafe extern "system" fn ComponentHandler_end_edit(_this: *mut c_void, _id: ParamID) -> tresult { kResultOk }
unsafe extern "system" fn ComponentHandler_restart_component(_this: *mut c_void, _flags: i32) -> tresult { kResultOk }

#[repr(C)]
struct PlugFrame {
    pub vptr: *const IPlugFrameVTableLayout,
    ref_count: AtomicI32,
    hwnd: HWND,
}
#[repr(C)]
struct IPlugFrameVTableLayout {
    pub query_interface: unsafe extern "system" fn(*mut c_void, *const IID, *mut *mut c_void) -> i32,
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
        let width = rect.right - rect.left;
        let height = rect.bottom - rect.top;
        
        // Resize window request from Plugin
        let mut win_rect = RECT { left: 0, top: 0, right: width, bottom: height };
        AdjustWindowRect(&mut win_rect, WS_OVERLAPPEDWINDOW, false);
        let full_width = win_rect.right - win_rect.left;
        let full_height = win_rect.bottom - win_rect.top;
        
        SetWindowPos(f.hwnd, None, 0, 0, full_width, full_height, SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE);
    }
    kResultOk
}

fn create_host_app() -> *mut c_void {
    let app = Box::new(HostApplication {
        vptr: &HOST_APP_VTBL,
        ref_count: AtomicI32::new(1),
    });
    Box::into_raw(app) as *mut c_void
}
fn create_component_handler() -> *mut c_void {
    let h = Box::new(ComponentHandler {
        vptr: &COMP_HANDLER_VTBL,
        ref_count: AtomicI32::new(1),
    });
    Box::into_raw(h) as *mut c_void
}
fn create_plug_frame(hwnd: HWND) -> *mut c_void {
    let f = Box::new(PlugFrame {
        vptr: &PLUG_FRAME_VTBL,
        ref_count: AtomicI32::new(1),
        hwnd,
    });
    Box::into_raw(f) as *mut c_void
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

    // Wait for initialization result. If thread sends Ok, it means window is open.
    // If thread sends Err, it means failed.
    rx.recv().map_err(|e| format!("Receive error: {}", e))?
}

unsafe fn run_vst_thread(path: &str, tx: std::sync::mpsc::Sender<Result<(), String>>) -> Result<(), String> {
    CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok();

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
    
    // Create initially hidden or default size
    let hwnd = CreateWindowExW(
        WINDOW_EX_STYLE::default(),
        class_name,
        w!("DAWIY Native VST3"),
        WS_OVERLAPPEDWINDOW, // Not visible yet
        CW_USEDEFAULT, CW_USEDEFAULT,
        800, 600,
        None, None, instance, None
    );
    
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
    let mut component_uid: Option<IID> = None;
    for i in 0..count {
            let mut info = std::mem::zeroed::<vst3_sys::base::PClassInfo>();
            if (factory_vtbl.GetClassInfo)(this_ptr, i, &mut info) == kResultOk {
                component_uid = Some(info.cid);
                break;
            }
    }
    let cid = component_uid.unwrap();
    
    let mut component_ptr: *mut c_void = std::ptr::null_mut();
    let i_component_iid = <dyn IComponent as ComInterface>::IID; 
    if (factory_vtbl.CreateInstance)(this_ptr, &cid, &i_component_iid, &mut component_ptr) != kResultOk {
            return Err("Failed to create component".into());
    }
    let component = VstPtr::<dyn IComponent>::owned(component_ptr as *mut *mut _).unwrap();
    
    let host_app = create_host_app();
    component.set_io_mode(vst3_sys::vst::IoModes::kSimple as i32);
    if component.initialize(host_app as *mut c_void) != kResultOk {
            return Err("Failed initialize".into());
    }

    let mut edit_controller: Option<VstPtr<dyn IEditController>> = None;
    let mut controller_iid: IID = std::mem::zeroed();

    if component.get_controller_class_id(&mut controller_iid) == kResultOk {
        let mut controller_ptr: *mut c_void = std::ptr::null_mut();
        let i_edit_iid = <dyn IEditController as ComInterface>::IID;
        if (factory_vtbl.CreateInstance)(this_ptr, &controller_iid, &i_edit_iid, &mut controller_ptr) == kResultOk && !controller_ptr.is_null() {
                let controller = VstPtr::<dyn IEditController>::owned(controller_ptr as *mut *mut _).unwrap();
                if controller.initialize(host_app as *mut c_void) == kResultOk {
                    edit_controller = Some(controller);
                }
        }
    }
    if edit_controller.is_none() {
        let mut edit_controller_ptr: *mut c_void = std::ptr::null_mut();
        let i_edit_iid = <dyn IEditController as ComInterface>::IID;
        if component.query_interface(&i_edit_iid, &mut edit_controller_ptr) == kResultOk {
                edit_controller = VstPtr::<dyn IEditController>::owned(edit_controller_ptr as *mut *mut _);
        }
    }
    let edit_controller = edit_controller.ok_or("No controller")?;
    
    let handler_raw = create_component_handler();
    
    // Re-interprete cast for SharedVstPtr
    #[repr(transparent)]
    struct MySharedVstPtr { ptr: *mut *mut c_void }
    let handler_arg: vst3_sys::utils::SharedVstPtr<dyn IComponentHandler> = std::mem::transmute(handler_raw);
    edit_controller.set_component_handler(handler_arg);

    // Create View
    let mut fs_name = [0u8; 128]; 
    let editor_s = b"editor\0";
    for (i, &b) in editor_s.iter().enumerate() { fs_name[i] = b; }
    
    let view_ptr_void = edit_controller.create_view(fs_name.as_ptr() as *const i8);
    if view_ptr_void.is_null() {
            return Err("No view".into());
    }
    let view = VstPtr::<dyn IPlugView>::owned(view_ptr_void as *mut *mut _).unwrap();

    // Attach View info to Window for Resize
    // We cannot pass Rust Objects (VstPtr) easily to wnd_proc globally.
    // We can store the raw pointer to IPlugView interface in GWLP_USERDATA.
    // IPlugView interface pointer is `*mut *mut VTable`.
    let view_raw_interface = view.as_ptr(); 
    SetWindowLongPtrW(hwnd, GWLP_USERDATA, view_raw_interface as isize);

    // Initial Resize
    let mut rect = vst3_sys::gui::ViewRect::default();
    view.get_size(&mut rect);
    let mut width = rect.right - rect.left;
    let mut height = rect.bottom - rect.top;
    if width <= 0 { width = 800; }
    if height <= 0 { height = 600; }
    
    let mut win_rect = RECT { left: 0, top: 0, right: width, bottom: height };
    AdjustWindowRect(&mut win_rect, WS_OVERLAPPEDWINDOW, false);
    let full_width = win_rect.right - win_rect.left;
    let full_height = win_rect.bottom - win_rect.top;
    
    SetWindowPos(hwnd, None, 0, 0, full_width, full_height, SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE);

    // Attach
    let plug_frame = create_plug_frame(hwnd);
    view.set_frame(plug_frame); // pass pointer to PlugFrame interface
    
    let type_hwnd = b"HWND\0".as_ptr() as *const i8;
    if view.attached(hwnd.0 as *mut c_void, type_hwnd) != kResultOk {
        return Err("Failed to attach".into());
    }

    // Show Window
    windows::Win32::UI::WindowsAndMessaging::ShowWindow(hwnd, SW_SHOW);
    
    // Everything OK - Signal Success
    tx.send(Ok(())).unwrap_or(()); 

    // Message Loop
    let mut msg = MSG::default();
    loop {
        if GetMessageW(&mut msg, None, 0, 0).as_bool() == false {
            break;
        }
        TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }
    
    // Cleanup
    view.removed();
    
    // Drop logic
    // We wrapped view in VstPtr, correct? But we also stored raw ptr in UserData.
    // UserData doesn't own it. VstPtr owns it.
    // Set UserData to 0
    SetWindowLongPtrW(hwnd, GWLP_USERDATA, 0);

    drop(view);
    drop(edit_controller);
    component.terminate();
    drop(component);
    drop(factory);
    
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
            // Retrieve IPlugView pointer
            let ptr_val = GetWindowLongPtrW(hwnd, GWLP_USERDATA);
            if ptr_val != 0 {
                // This is *mut *mut IPlugViewVTable
                let view_interface_ptr = ptr_val as *mut *mut <dyn IPlugView as ComInterface>::VTable;
                // Construct temporary reference to call on_size
                // We don't own it here, just borrowing for the call.
                // We can't use VstPtr::from_raw because it might alter refcount? 
                // VstPtr doesn't have "borrow_from_raw".
                // We manually invoke VTable.
                let vptr_ptr = *view_interface_ptr;
                let vptr = &*vptr_ptr;
                
                // Get new client size
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
