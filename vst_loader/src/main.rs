use libloading::{Library, Symbol};
use std::path::Path;
use std::ffi::c_void;

// Signature of the GetPluginFactory function exported by VST3 plugins.
// Steinberg::tresult PLUGIN_API GetPluginFactory (Steinberg::IPluginFactory** factory)
type GetPluginFactory = unsafe extern "system" fn(factory: *mut *mut c_void) -> i32;

fn main() {
    println!("Starting VST3 Loader Prototype...");
    
    // Hardcoded path to a likely VST3 plugin (adjust as needed based on file search results)
    // Using one that seemed to be a file: "Basslane.vst3" in Common Files.
    let vst_path = r"C:\Program Files\Common Files\VST3\Basslane.vst3";
    let path = Path::new(vst_path);

    if !path.exists() {
        println!("Error: File not found at {:?}", path);
        return;
    }

    println!("Attempting to load VST3 from: {:?}", path);

    unsafe {
        let lib = match Library::new(path) {
            Ok(l) => l,
            Err(e) => {
                println!("Failed to load library: {:?}", e);
                return;
            }
        };

        println!("Library loaded successfully!");

        let func: Symbol<GetPluginFactory> = match lib.get(b"GetPluginFactory") {
            Ok(f) => f,
            Err(e) => {
                println!("Failed to find GetPluginFactory symbol: {:?}", e);
                return;
            }
        };

        println!("Found 'GetPluginFactory' symbol!");
        println!("VST3 Plugin is loadable and has valid entry point.");
        
        // In a real host, we would call func(&mut factory_ptr) here.
        // For prototype verification, just finding it is a huge success.
    }
}
