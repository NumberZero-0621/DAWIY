use std::ffi::c_void;
use std::os::raw::{c_char, c_int};
use std::ptr;
use std::thread;

use libloading::{Library, Symbol};
use winit::event::{Event, WindowEvent};
use winit::event_loop::{ControlFlow, EventLoopBuilder};
use winit::platform::windows::EventLoopBuilderExtWindows;
use winit::window::WindowBuilder;
use winit::raw_window_handle::{HasRawWindowHandle, RawWindowHandle};

// --- Manual VST3 / COM Definitions ---

// Basic types
type TResult = i32;
const K_RESULT_OK: TResult = 0;
const K_NO_INTERFACE: TResult = -2147467262; // 0x80004002 (E_NOINTERFACE)
const K_RESULT_FALSE: TResult = 1;
const K_NOT_IMPLEMENTED: TResult = -2147467263; // 0x80004001 (E_NOTIMPL)

// GUID/IID struct
#[repr(C)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub struct TUID {
    pub data: [u8; 16],
}

impl std::fmt::Debug for TUID {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{:02X}{:02X}{:02X}{:02X}-{:02X}{:02X}-{:02X}{:02X}-{:02X}{:02X}-{:02X}{:02X}{:02X}{:02X}{:02X}{:02X}",
            self.data[3], self.data[2], self.data[1], self.data[0],
            self.data[5], self.data[4],
            self.data[7], self.data[6],
            self.data[8], self.data[9],
            self.data[10], self.data[11], self.data[12], self.data[13], self.data[14], self.data[15]
        )
    }
}

// IID constants
// IHostApplication: 58E595CC-db2D-4969-8B62-D3D953323D8E
const I_HOST_APPLICATION_IID: TUID = TUID { data: [0xCC, 0x95, 0xE5, 0x58, 0x2D, 0xdb, 0x69, 0x49, 0x8B, 0x62, 0xD3, 0xD9, 0x53, 0x32, 0x3D, 0x8E] };
const I_UNKNOWN_IID: TUID = TUID { data: [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xC0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x46] };

// IComponent: E831FF31-F2D5-4301-928E-BBEE256975F2 (LE)
const I_COMPONENT_IID_LE: TUID = TUID { data: [0x31, 0xFF, 0x31, 0xE8, 0xD5, 0xF2, 0x01, 0x43, 0x92, 0x8E, 0xBB, 0xEE, 0x25, 0x69, 0x75, 0xF2] };
const I_COMPONENT_IID_BE: TUID = TUID { data: [0xE8, 0x31, 0xFF, 0x31, 0xF2, 0xD5, 0x43, 0x01, 0x92, 0x8E, 0xBB, 0xEE, 0x25, 0x69, 0x75, 0xF2] };

// IEditController: DCD7BBE3-7742-4722-A491-5859E140BF47 (LE)
const I_EDIT_CONTROLLER_IID_LE: TUID = TUID { data: [0xE3, 0xBB, 0xD7, 0xDC, 0x42, 0x77, 0x22, 0x47, 0xA4, 0x91, 0x58, 0x59, 0xE1, 0x40, 0xBF, 0x47] };
const I_EDIT_CONTROLLER_IID_BE: TUID = TUID { data: [0xDC, 0xD7, 0xBB, 0xE3, 0x77, 0x42, 0x47, 0x22, 0xA4, 0x91, 0x58, 0x59, 0xE1, 0x40, 0xBF, 0x47] };

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
    pub base: IUnknownVTable, // 0..2
    // IPluginBase
    pub initialize: unsafe extern "system" fn(this: *mut c_void, context: *mut c_void) -> TResult, // 3
    pub terminate: unsafe extern "system" fn(this: *mut c_void) -> TResult, // 4
    // IComponent (partial)
    pub get_controller_class_id: unsafe extern "system" fn(this: *mut c_void, class_id: *mut TUID) -> TResult, // 5
}

#[repr(C)]
pub struct IEditControllerVTable {
    pub base: IUnknownVTable, // 0..2
    // IPluginBase
    pub initialize: unsafe extern "system" fn(this: *mut c_void, context: *mut c_void) -> TResult, // 3
    pub terminate: unsafe extern "system" fn(this: *mut c_void) -> TResult, // 4
    // IEditController
    pub set_component_state: unsafe extern "system" fn(this: *mut c_void, state: *mut c_void) -> TResult, // 5
    // ...
    // Note: To be safe, we should have full definition if we call methods further down
    pub set_state: unsafe extern "system" fn(this: *mut c_void, state: *mut c_void) -> TResult, // 6
    pub get_state: unsafe extern "system" fn(this: *mut c_void, state: *mut c_void) -> TResult, // 7
    pub get_parameter_count: unsafe extern "system" fn(this: *mut c_void) -> i32, // 8
    pub get_parameter_info: unsafe extern "system" fn(this: *mut c_void, param_index: i32, info: *mut c_void) -> TResult, // 9
    pub get_param_string_by_value: unsafe extern "system" fn(this: *mut c_void, id: u32, value_normalized: f64, string: *mut c_void) -> TResult, // 10
    pub get_param_value_by_string: unsafe extern "system" fn(this: *mut c_void, id: u32, string: *mut c_void, value_normalized: *mut f64) -> TResult, // 11
    pub normalized_param_to_plain: unsafe extern "system" fn(this: *mut c_void, id: u32, value_normalized: f64) -> f64, // 12
    pub plain_param_to_normalized: unsafe extern "system" fn(this: *mut c_void, id: u32, plain_value: f64) -> f64, // 13
    pub get_param_normalized: unsafe extern "system" fn(this: *mut c_void, id: u32) -> f64, // 14
    pub set_param_normalized: unsafe extern "system" fn(this: *mut c_void, id: u32, value: f64) -> TResult, // 15
    pub set_component_handler: unsafe extern "system" fn(this: *mut c_void, handler: *mut c_void) -> TResult, // 16
    pub create_view: unsafe extern "system" fn(this: *mut c_void, name: *const c_char) -> *mut *mut IPlugViewVTable, // 17 - returns IPlugView*
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

// --- Dummy Host Application ---

#[repr(C)]
struct IHostApplicationVTable {
    base: IUnknownVTable,
    get_name: unsafe extern "system" fn(this: *mut c_void, name: *mut c_void) -> TResult,
    create_instance: unsafe extern "system" fn(this: *mut c_void, cid: *const TUID, iid: *const TUID, obj: *mut *mut c_void) -> TResult,
}

// Static VTable for HostApp
static mut HOST_APP_VTABLE: IHostApplicationVTable = IHostApplicationVTable {
    base: IUnknownVTable {
        query_interface: host_query_interface,
        add_ref: host_add_ref,
        release: host_release,
    },
    get_name: host_get_name,
    create_instance: host_create_instance,
};

#[repr(C)]
struct HostApplication {
    vtable: *const IHostApplicationVTable,
    ref_count: u32,
}

// Implementations for HostApp
unsafe extern "system" fn host_query_interface(_this: *mut c_void, iid: *const TUID, obj: *mut *mut c_void) -> TResult {
    if iid.is_null() || obj.is_null() { return K_RESULT_FALSE; }
    let iid_ref = &*iid;
    if iid_ref == &I_UNKNOWN_IID || iid_ref == &I_HOST_APPLICATION_IID {
         *obj = _this;
         host_add_ref(_this);
         return K_RESULT_OK;
    }
    *obj = ptr::null_mut();
    K_NO_INTERFACE
}
unsafe extern "system" fn host_add_ref(_this: *mut c_void) -> u32 { 1 }
unsafe extern "system" fn host_release(_this: *mut c_void) -> u32 { 1 }

unsafe extern "system" fn host_get_name(_this: *mut c_void, _name: *mut c_void) -> TResult {
    K_NOT_IMPLEMENTED
}
unsafe extern "system" fn host_create_instance(_this: *mut c_void, _cid: *const TUID, _iid: *const TUID, _obj: *mut *mut c_void) -> TResult {
    K_NOT_IMPLEMENTED
}


fn c_char_to_string(c_char_array: &[c_char]) -> String {
    let bytes: Vec<u8> = c_char_array.iter().map(|&c| c as u8).take_while(|&c| c != 0).collect();
    String::from_utf8_lossy(&bytes).into_owned()
}

// --- Implementation ---

// Signature of GetPluginFactory
type GetPluginFactory = unsafe extern "C" fn() -> *mut *mut IPluginFactoryVTable;

pub fn load_and_open(path: String) -> Result<(), String> {
    println!("[TAURI] Native Host: Loading VST3 from {}", path);

    let _handle = thread::spawn(move || {
        if let Err(e) = run_vst_host(&path) {
            eprintln!("[TAURI] VST Host Error: {}", e);
        }
    });

    Ok(())
}

fn run_vst_host(path: &str) -> Result<(), String> {
    unsafe {
        // Setup Host Application
        let host_app = HostApplication {
            vtable: &HOST_APP_VTABLE,
            ref_count: 1,
        };
        let host_app_ptr = &host_app as *const HostApplication as *mut c_void;

        // 1. Load Library
        let lib = Library::new(path).map_err(|e| format!("Failed to load DLL: {}", e))?;
        let get_factory_fn: Symbol<GetPluginFactory> = lib.get(b"GetPluginFactory")
            .map_err(|e| format!("GetPluginFactory not found: {}", e))?;

        // 2. Get Factory
        let factory_ptr = get_factory_fn();
        if factory_ptr.is_null() {
            return Err("Failed to get IPluginFactory: returned null".to_string());
        }
        let factory_vtable = &*( *factory_ptr );

        // 3. Iterate Classes
        let count = (factory_vtable.count_classes)(factory_ptr as *mut c_void);
        println!("[TAURI] VST Factory has {} classes", count);

        if count == 0 {
            return Err("No classes in factory".to_string());
        }

        let mut controller_ptr: *mut c_void = ptr::null_mut();
        let mut found = false;

        // First, enumerate all classes and collect info
        println!("[TAURI] Enumerating classes...");
        
        // Strategy 1: Look for "Component Controller Class" and instantiate directly
        for i in 0..count {
            let mut info: PClassInfo = std::mem::zeroed();
            if (factory_vtable.get_class_info)(factory_ptr as *mut c_void, i, &mut info) == K_RESULT_OK {
                let name = c_char_to_string(&info.name);
                let category = c_char_to_string(&info.category);
                println!("[TAURI] Class {}: Name='{}', Category='{}', CID={:?}", i, name, category, info.cid);
                
                if category == "Component Controller Class" {
                    println!("[TAURI] Found Controller Class directly! Creating with FUnknown IID...");
                    
                    let mut ctl_ptr: *mut c_void = ptr::null_mut();
                    let create_res = (factory_vtable.create_instance)(
                        factory_ptr as *mut c_void,
                        &info.cid,
                        &I_UNKNOWN_IID,
                        &mut ctl_ptr
                    );
                    
                    if create_res == K_RESULT_OK && !ctl_ptr.is_null() {
                        println!("[TAURI] Created Controller with FUnknown IID");
                        
                        // Get base vtable for QueryInterface
                        let base_vtable = &*( * (ctl_ptr as *mut *mut IUnknownVTable) );
                        
                        // Initialize first (some plugins need this before QI works properly)
                        // Use IPluginBase layout - initialize is at offset 3
                        let pluginbase_vtable = &*( * (ctl_ptr as *mut *mut IEditControllerVTable) );
                        let init_res = (pluginbase_vtable.initialize)(ctl_ptr, host_app_ptr);
                        println!("[TAURI] Controller Initialize Result: 0x{:X}", init_res);
                        
                        // Now call QueryInterface to get the correct IEditController pointer
                        let mut edit_ctl_ptr: *mut c_void = ptr::null_mut();
                        let mut qi_res = (base_vtable.query_interface)(
                            ctl_ptr,
                            &I_EDIT_CONTROLLER_IID_LE,
                            &mut edit_ctl_ptr
                        );
                        
                        if qi_res != K_RESULT_OK || edit_ctl_ptr.is_null() {
                            println!("[TAURI] QI for IEditController (LE) failed: 0x{:X}, trying BE...", qi_res);
                            qi_res = (base_vtable.query_interface)(
                                ctl_ptr,
                                &I_EDIT_CONTROLLER_IID_BE,
                                &mut edit_ctl_ptr
                            );
                        }
                        
                        if qi_res == K_RESULT_OK && !edit_ctl_ptr.is_null() {
                            println!("[TAURI] QI for IEditController succeeded! Got proper pointer.");
                            controller_ptr = edit_ctl_ptr;
                            found = true;
                            break;
                        } else {
                            println!("[TAURI] QI for IEditController failed: 0x{:X}. Using original pointer (may not work).", qi_res);
                            // Fall back to original pointer - might not work
                            controller_ptr = ctl_ptr;
                            found = true;
                            break;
                        }
                    } else {
                        println!("[TAURI] Failed to create Controller: 0x{:X}", create_res);
                    }
                }
            }
        }
        
        // Strategy 2: If no Controller class found, try Audio Module (merged architecture)
        if !found {
            println!("[TAURI] No Controller class found, trying Audio Module for merged architecture...");
            for i in 0..count {
                let mut info: PClassInfo = std::mem::zeroed();
                if (factory_vtable.get_class_info)(factory_ptr as *mut c_void, i, &mut info) == K_RESULT_OK {
                    let category = c_char_to_string(&info.category);
                    
                    if category == "Audio Module Class" {
                        println!("[TAURI] Found Audio Module. Creating...");
                        
                        let mut comp_ptr: *mut c_void = ptr::null_mut();
                        let create_res = (factory_vtable.create_instance)(
                            factory_ptr as *mut c_void,
                            &info.cid,
                            &I_UNKNOWN_IID,
                            &mut comp_ptr
                        );
                        
                        if create_res == K_RESULT_OK && !comp_ptr.is_null() {
                            let comp_vtable = &*( * (comp_ptr as *mut *mut IComponentVTable) );
                            let init_res = (comp_vtable.initialize)(comp_ptr, host_app_ptr);
                            println!("[TAURI] Component Initialize Result: 0x{:X}", init_res);
                            
                            // Use as controller (might work for merged architecture)
                            controller_ptr = comp_ptr;
                            found = true;
                            break;
                        }
                    }
                }
            }
        }

        if !found || controller_ptr.is_null() {
             return Err("Failed to obtain IEditController (Tried both QI and Split Architecture)".to_string());
        }

        // DEBUG: Examine the vtable pointer structure
        println!("[TAURI] DEBUG: controller_ptr = {:?}", controller_ptr);
        
        // The object's first field should be a vtable pointer
        let vtable_ptr_ptr = controller_ptr as *const *const u8;
        let vtable_ptr = *vtable_ptr_ptr;
        println!("[TAURI] DEBUG: vtable[0] (first vtable) = {:?}", vtable_ptr);
        
        // Check if there's a second vtable pointer (for multiple inheritance)
        let second_ptr_ptr = (controller_ptr as *const usize).add(1);
        let second_ptr = *second_ptr_ptr;
        println!("[TAURI] DEBUG: object[1] (possible second vtable) = 0x{:016X}", second_ptr);
        
        // Check for more vtable pointers
        let third_ptr = *((controller_ptr as *const usize).add(2));
        let fourth_ptr = *((controller_ptr as *const usize).add(3));
        println!("[TAURI] DEBUG: object[2] = 0x{:016X}", third_ptr);
        println!("[TAURI] DEBUG: object[3] = 0x{:016X}", fourth_ptr);
        
        // If second_ptr looks like a valid pointer (high bits set like 0x7FFCxxxxxxxx), it might be another vtable
        if second_ptr > 0x7FF000000000 && second_ptr < 0x800000000000 {
            println!("[TAURI] DEBUG: object[1] looks like a pointer! Checking its vtable (0-20)...");
            let second_vtable_ptr = second_ptr as *const usize;
            for i in 0..21 {
                let fn_ptr = *second_vtable_ptr.add(i);
                println!("[TAURI] DEBUG: second_vtable[{}] = 0x{:016X}", i, fn_ptr);
            }
        }
        
        // Check if object[2] is also a vtable
        if third_ptr > 0x7FF000000000 && third_ptr < 0x800000000000 {
            println!("[TAURI] DEBUG: object[2] looks like a pointer! Checking its vtable (0-20)...");
            let third_vtable_ptr = third_ptr as *const usize;
            for i in 0..21 {
                let fn_ptr = *third_vtable_ptr.add(i);
                println!("[TAURI] DEBUG: third_vtable[{}] = 0x{:016X}", i, fn_ptr);
            }
        }
        
        // Read the first few function pointers from the vtable
        let vtable_as_fn_ptrs = vtable_ptr as *const usize;
        for i in 0..21 {
            let fn_ptr = *vtable_as_fn_ptrs.add(i);
            println!("[TAURI] DEBUG: vtable[{}] = 0x{:016X}", i, fn_ptr);
        }
        // Try using the SECOND vtable (object[1]) as IEditController!
        // In multiple inheritance, this might be the IEditController interface
        let edit_controller_this = (controller_ptr as *mut u8).add(8) as *mut c_void;  // Adjusted this pointer
        // object[1] IS the vtable pointer itself, not a pointer to it - so cast directly
        let edit_controller_vtable_ptr = *((controller_ptr as *const usize).add(1)) as *const IEditControllerVTable;
        let edit_controller_vtable = &*edit_controller_vtable_ptr;
        
        println!("[TAURI] Trying SECOND vtable as IEditController...");
        println!("[TAURI] DEBUG: edit_controller_this = {:?}", edit_controller_this);
        println!("[TAURI] DEBUG: edit_controller_vtable_ptr = {:?}", edit_controller_vtable_ptr);
        
        // Test with second vtable
        let param_count_v2 = (edit_controller_vtable.get_parameter_count)(edit_controller_this);
        println!("[TAURI] DEBUG: getParameterCount (via second vtable) returned: {}", param_count_v2);
        
        // Also test with first vtable for comparison
        let controller_vtable = &*( * (controller_ptr as *mut *mut IEditControllerVTable) );
        println!("[TAURI] Got EditController Interface");
        
        // Test addRef to verify basic COM functionality
        let ref_count = (controller_vtable.base.add_ref)(controller_ptr);
        println!("[TAURI] DEBUG: addRef() returned: {}", ref_count);

        // 6. Create Window (winit 0.29 - using any_thread for spawned thread support)
        let event_loop = EventLoopBuilder::new().with_any_thread(true).build().unwrap();
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
        
        println!("[TAURI] Created Window, HWND: {:?}", hwnd);

        // DEBUG: Test VTable layout by calling getParameterCount (using first vtable)
        let param_count = (controller_vtable.get_parameter_count)(controller_ptr);
        println!("[TAURI] DEBUG: getParameterCount (via first vtable) returned: {}", param_count);

        // Note: For multiple inheritance, the this pointer needs to be adjusted
        // to point to the sub-object for the interface being called
        let (final_controller_ptr, final_vtable): (*mut c_void, &IEditControllerVTable) = 
            if param_count_v2 > 0 {
                println!("[TAURI] Using SECOND vtable (param_count_v2 = {})", param_count_v2);
                // Use ADJUSTED this pointer (controller_ptr + 8) for second vtable
                (edit_controller_this, edit_controller_vtable)
            } else {
                println!("[TAURI] Using FIRST vtable (fallback)");
                (controller_ptr, controller_vtable)
            };

        // 7. Create View - createView returns IPlugView* directly
        let view_type = b"editor\0".as_ptr() as *const c_char;
        
        // DEBUG: Show which function pointer createView maps to
        let create_view_fn_ptr = final_vtable.create_view as usize;
        println!("[TAURI] DEBUG: create_view function pointer = 0x{:016X}", create_view_fn_ptr);
        println!("[TAURI] DEBUG: final_controller_ptr = {:?}", final_controller_ptr);
        
        // DIRECT FUNCTION POINTER CALLS - bypass struct to avoid layout issues
        // Get raw vtable pointer for the second vtable
        let raw_vtable = *((controller_ptr as *const usize).add(1)) as *const usize;
        
        // setComponentHandler is at index 16
        let set_component_handler_fn: unsafe extern "system" fn(*mut c_void, *mut c_void) -> TResult = 
            std::mem::transmute(*raw_vtable.add(16));
        println!("[TAURI] DEBUG: Direct setComponentHandler ptr = 0x{:016X}", *raw_vtable.add(16));
        
        println!("[TAURI] DEBUG: Calling setComponentHandler(null) DIRECTLY...");
        let set_handler_res = set_component_handler_fn(edit_controller_this, ptr::null_mut());
        println!("[TAURI] DEBUG: setComponentHandler result: 0x{:X}", set_handler_res);
        
        // createView is at index 17
        let create_view_fn: unsafe extern "system" fn(*mut c_void, *const c_char) -> *mut *mut IPlugViewVTable = 
            std::mem::transmute(*raw_vtable.add(17));
        println!("[TAURI] DEBUG: Direct createView ptr = 0x{:016X}", *raw_vtable.add(17));
        
        println!("[TAURI] DEBUG: Calling createView with viewType='editor' DIRECTLY...");
        let view_ptr: *mut *mut IPlugViewVTable = create_view_fn(edit_controller_this, view_type);
        
        println!("[TAURI] create_view returned: {:?}", view_ptr);
        
        if view_ptr.is_null() {
             return Err("Failed to create IPlugView (returned null)".to_string());
        }
        
        let view_vtable = &*( * view_ptr );
        println!("[TAURI] Got IPlugView");

        // 8. Attach View
        let type_hwnd = "HWND\0".as_ptr() as *const c_char;
        
        // Check size?
        let mut size: ViewRect = std::mem::zeroed();
        if (view_vtable.get_size)(view_ptr as *mut c_void, &mut size) == K_RESULT_OK {
             let width = (size.right - size.left).abs();
             let height = (size.bottom - size.top).abs();
             let _ = window.request_inner_size(winit::dpi::LogicalSize::new(width as f64, height as f64));
        }

        let res_attach = (view_vtable.attached)(view_ptr as *mut c_void, hwnd, type_hwnd);
        if res_attach != K_RESULT_OK {
             return Err(format!("Failed to attach view: {}", res_attach));
        }

        println!("[TAURI] Attached View! Running loop...");

        // 9. Run Event Loop (winit 0.29)
        let _ = event_loop.run(move |event, target| {
            target.set_control_flow(ControlFlow::Wait);

            match event {
                Event::WindowEvent {
                    event: WindowEvent::CloseRequested,
                    window_id,
                } if window_id == window.id() => {
                    // Cleanup
                    unsafe { 
                        (view_vtable.removed)(view_ptr as *mut c_void); 
                        // (controller_vtable.terminate)(controller_ptr); // Terminate controller?
                    }
                    target.exit();
                },
                _ => ()
            }
        });
    }

    Ok(())
}
