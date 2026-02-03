use std::ffi::c_void;
use std::os::raw::{c_char, c_int};
use std::ptr;
use std::thread;

use libloading::{Library, Symbol};
use winit::event::{Event, WindowEvent};
use winit::event_loop::{ControlFlow, EventLoop};
use winit::window::WindowBuilder;
use winit::raw_window_handle::{HasRawWindowHandle, RawWindowHandle};

// --- Manual VST3 / COM Definitions ---

// Basic types
type TResult = i32;
const K_RESULT_OK: TResult = 0;

// GUID/IID struct
#[repr(C)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TUID {
    pub data: [u8; 16],
}

impl TUID {
    pub const fn from_u128(uuid: u128) -> Self {
        Self { data: uuid.to_le_bytes() }
    }
}

#[repr(C)]
pub struct IUnknownVTable {
    pub query_interface: unsafe extern "system" fn(this: *mut c_void, iid: *const TUID, obj: *mut *mut c_void) -> TResult,
    pub add_ref: unsafe extern "system" fn(this: *mut c_void) -> u32,
    pub release: unsafe extern "system" fn(this: *mut c_void) -> u32,
}

#[repr(C)]
pub struct IPluginFactoryVTable {
    pub base: IUnknownVTable,
    pub get_factory_info: unsafe extern "system" fn(this: *mut c_void, info: *mut c_void) -> TResult,
    pub count_classes: unsafe extern "system" fn(this: *mut c_void) -> i32,
    pub get_class_info: unsafe extern "system" fn(this: *mut c_void, index: i32, info: *mut PClassInfo) -> TResult,
    pub create_instance: unsafe extern "system" fn(this: *mut c_void, cid: *const TUID, iid: *const TUID, obj: *mut *mut c_void) -> TResult,
}

#[repr(C)]
pub struct PClassInfo {
    pub cid: TUID,
    pub cardinality: i32,
    pub category: [c_char; 32],
    pub name: [c_char; 64],
}

#[repr(C)]
pub struct IComponentVTable {
    pub base: IUnknownVTable,
    pub get_controller_class_id: unsafe extern "system" fn(this: *mut c_void, class_id: *mut TUID) -> TResult,
    pub set_io_mode: unsafe extern "system" fn(this: *mut c_void, mode: i32) -> TResult,
    pub get_bus_count: unsafe extern "system" fn(this: *mut c_void, media_type: i32, bus_dir: i32) -> i32,
    pub get_bus_info: unsafe extern "system" fn(this: *mut c_void, media_type: i32, bus_dir: i32, index: i32, info: *mut c_void) -> TResult,
    pub get_routing_info: unsafe extern "system" fn(this: *mut c_void, in_info: *mut c_void, out_info: *mut c_void) -> TResult,
    pub activate_bus: unsafe extern "system" fn(this: *mut c_void, media_type: i32, bus_dir: i32, index: i32, state: u8) -> TResult,
    pub set_active: unsafe extern "system" fn(this: *mut c_void, state: u8) -> TResult,
    pub set_state: unsafe extern "system" fn(this: *mut c_void, state: *mut c_void) -> TResult,
    pub get_state: unsafe extern "system" fn(this: *mut c_void, state: *mut c_void) -> TResult,
}

#[repr(C)]
pub struct IEditControllerVTable {
    pub base: IUnknownVTable,
    pub set_component_state: unsafe extern "system" fn(this: *mut c_void, state: *mut c_void) -> TResult,
    pub set_state: unsafe extern "system" fn(this: *mut c_void, state: *mut c_void) -> TResult,
    pub get_state: unsafe extern "system" fn(this: *mut c_void, state: *mut c_void) -> TResult,
    pub get_parameter_count: unsafe extern "system" fn(this: *mut c_void) -> i32,
    pub get_parameter_info: unsafe extern "system" fn(this: *mut c_void, param_index: i32, info: *mut c_void) -> TResult,
    pub get_param_string_by_value: unsafe extern "system" fn(this: *mut c_void, id: u32, value_normalized: f64, string: *mut c_void) -> TResult,
    pub get_param_value_by_string: unsafe extern "system" fn(this: *mut c_void, id: u32, string: *mut c_void, value_normalized: *mut f64) -> TResult,
    pub normalized_param_to_plain: unsafe extern "system" fn(this: *mut c_void, id: u32, value_normalized: f64) -> f64,
    pub plain_param_to_normalized: unsafe extern "system" fn(this: *mut c_void, id: u32, plain_value: f64) -> f64,
    pub get_param_normalized: unsafe extern "system" fn(this: *mut c_void, id: u32) -> f64,
    pub set_param_normalized: unsafe extern "system" fn(this: *mut c_void, id: u32, value: f64) -> TResult,
    pub set_component_handler: unsafe extern "system" fn(this: *mut c_void, handler: *mut c_void) -> TResult,
    pub create_view: unsafe extern "system" fn(this: *mut c_void, name: *const c_char, view: *mut *mut *mut IPlugViewVTable) -> TResult,
}

#[repr(C)]
pub struct IPlugViewVTable {
    pub base: IUnknownVTable,
    pub is_platform_type_supported: unsafe extern "system" fn(this: *mut c_void, type_: *const c_char) -> TResult,
    pub attached: unsafe extern "system" fn(this: *mut c_void, parent: *mut c_void, type_: *const c_char) -> TResult,
    pub removed: unsafe extern "system" fn(this: *mut c_void) -> TResult,
    pub on_wheel: unsafe extern "system" fn(this: *mut c_void, distance: f32) -> TResult,
    pub on_key_down: unsafe extern "system" fn(this: *mut c_void, key: c_int, key_code: c_int, modifiers: c_int) -> TResult,
    pub on_key_up: unsafe extern "system" fn(this: *mut c_void, key: c_int, key_code: c_int, modifiers: c_int) -> TResult,
    pub get_size: unsafe extern "system" fn(this: *mut c_void, size: *mut ViewRect) -> TResult,
    pub on_size: unsafe extern "system" fn(this: *mut c_void, new_size: *mut ViewRect) -> TResult,
    pub on_focus: unsafe extern "system" fn(this: *mut c_void, state: u8) -> TResult,
    pub set_frame: unsafe extern "system" fn(this: *mut c_void, frame: *mut c_void) -> TResult,
    pub can_resize: unsafe extern "system" fn(this: *mut c_void) -> TResult,
    pub check_size_constraint: unsafe extern "system" fn(this: *mut c_void, rect: *mut ViewRect) -> TResult,
}

#[repr(C)]
pub struct ViewRect {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}

// IID constants
const I_PLUGIN_FACTORY_IID: TUID = TUID { data: [0xBB, 0xC5, 0x8F, 0xF6, 0x1E, 0xC5, 0x02, 0x4B, 0x92, 0x2D, 0x74, 0x48, 0xC6, 0x85, 0x5D, 0xF1] };
const I_COMPONENT_IID: TUID = TUID { data: [0x31, 0xFF, 0x31, 0xE8, 0xD5, 0xF2, 0x01, 0x43, 0x92, 0x8E, 0xBB, 0xEE, 0x25, 0x69, 0x75, 0xF2] };
const I_EDIT_Controller_IID: TUID = TUID { data: [0xE3, 0xBB, 0xD7, 0xDC, 0x42, 0x77, 0x22, 0x47, 0xA4, 0x91, 0x58, 0x59, 0xE1, 0x40, 0xBF, 0x47] };


// --- Implementation ---

// Signature of GetPluginFactory
type GetPluginFactory = unsafe extern "system" fn(factory: *mut *mut *mut IPluginFactoryVTable) -> i32;

pub fn load_and_open(path: String) -> Result<(), String> {
    println!("Native Host: Loading VST3 from {}", path);

    let _handle = thread::spawn(move || {
        if let Err(e) = run_vst_host(&path) {
            eprintln!("VST Host Error: {}", e);
        }
    });

    Ok(())
}

fn run_vst_host(path: &str) -> Result<(), String> {
    unsafe {
        // 1. Load Library
        let lib = Library::new(path).map_err(|e| format!("Failed to load DLL: {}", e))?;
        let get_factory: Symbol<GetPluginFactory> = lib.get(b"GetPluginFactory")
            .map_err(|e| format!("GetPluginFactory not found: {}", e))?;

        // 2. Get Factory
        let mut factory_ptr: *mut *mut IPluginFactoryVTable = ptr::null_mut();
        if get_factory(&mut factory_ptr) != K_RESULT_OK {
            return Err("Failed to get IPluginFactory".to_string());
        }
        let factory_vtable = &*( *factory_ptr );

        // 3. Iterate Classes
        let count = (factory_vtable.count_classes)(factory_ptr as *mut c_void);
        println!("VST Factory has {} classes", count);

        if count == 0 {
            return Err("No classes in factory".to_string());
        }

        let mut instance_ptr: *mut c_void = ptr::null_mut();
        
        let mut found = false;
        for i in 0..count {
            let mut info: PClassInfo = std::mem::zeroed();
            if (factory_vtable.get_class_info)(factory_ptr as *mut c_void, i, &mut info) == K_RESULT_OK {
                 // Try to create Component
                 let res = (factory_vtable.create_instance)(
                     factory_ptr as *mut c_void,
                     &info.cid,
                     &I_COMPONENT_IID,
                     &mut instance_ptr 
                 );
                 
                 if res == K_RESULT_OK {
                     println!("Created instance of class index {}", i);
                     found = true;
                     break;
                 }
            }
        }

        if !found || instance_ptr.is_null() {
             return Err("Failed to create Component instance".to_string());
        }

        let component_ptr = instance_ptr; 
        let component_vtable = &*( * (component_ptr as *mut *mut IComponentVTable) );
        
        // 4. Initialize? Skipping for now as it needs IHostApplication

        // 5. Query IEditController
        let mut controller_ptr: *mut c_void = ptr::null_mut();
        let query_res = (component_vtable.base.query_interface)(
            component_ptr as *mut c_void,
            &I_EDIT_Controller_IID,
            &mut controller_ptr
        );
        
        if query_res != K_RESULT_OK {
            return Err("Component is not EditController (and split not supported)".to_string());
        }
        
        let controller_vtable = &*( * (controller_ptr as *mut *mut IEditControllerVTable) );
        println!("Got EditController");

        // 6. Create Window (winit 0.29)
        let event_loop = EventLoop::new().unwrap();
        let window = WindowBuilder::new()
            .with_title("VST3 Editor")
            .with_inner_size(winit::dpi::LogicalSize::new(800.0, 600.0))
            .build(&event_loop)
            .map_err(|e| format!("Failed to create window: {}", e))?;

        // Get HWND via HasRawWindowHandle
        let hwnd = if let Ok(RawWindowHandle::Win32(handle)) = window.raw_window_handle() {
            handle.hwnd.get()
        } else {
             return Err("Not a connection to a Windows window system".to_string());
        } as *mut c_void;
        
        println!("Created Window, HWND: {:?}", hwnd);

        // 7. Create View
        let mut view_ptr: *mut *mut IPlugViewVTable = ptr::null_mut();
        let create_view_res = (controller_vtable.create_view)(
            controller_ptr as *mut c_void,
            ptr::null(),
            &mut view_ptr
        );
        
        if create_view_res != K_RESULT_OK || view_ptr.is_null() {
             return Err("Failed to create IPlugView".to_string());
        }
        
        let view_vtable = &*( * view_ptr );
        println!("Got IPlugView");

        // 8. Attach View
        let type_hwnd = "HWND\0".as_ptr() as *const c_char;
        
        // Check size?
        let mut size: ViewRect = std::mem::zeroed();
        if (view_vtable.get_size)(view_ptr as *mut c_void, &mut size) == K_RESULT_OK {
             let width = (size.right - size.left).abs();
             let height = (size.bottom - size.top).abs();
             // Resize window to match plugin
             let _ = window.request_inner_size(winit::dpi::LogicalSize::new(width as f64, height as f64));
        }

        let res_attach = (view_vtable.attached)(view_ptr as *mut c_void, hwnd, type_hwnd);
        if res_attach != K_RESULT_OK {
             return Err(format!("Failed to attach view: {}", res_attach));
        }

        println!("Attached View! Running loop...");

        // 9. Run Event Loop (winit 0.29: closure takes 2 args)
        let _ = event_loop.run(move |event, target| {
            target.set_control_flow(ControlFlow::Wait);

            match event {
                Event::WindowEvent {
                    event: WindowEvent::CloseRequested,
                    window_id,
                } if window_id == window.id() => {
                    // Cleanup
                    unsafe { (view_vtable.removed)(view_ptr as *mut c_void); }
                    target.exit();
                },
                _ => ()
            }
        });
    }

    Ok(())
}
