// ----------------------------------------
// --- IParamValueQueue Implementation ---
// ----------------------------------------
use vst3_sys::vst::{IParamValueQueue, IParameterChanges};

#[repr(C)]
struct IParamValueQueueVTableLayout {
    pub query_interface: unsafe extern "system" fn(this: *mut c_void, iid: *const IID, obj: *mut *mut c_void) -> tresult,
    pub add_ref: unsafe extern "system" fn(this: *mut c_void) -> u32,
    pub release: unsafe extern "system" fn(this: *mut c_void) -> u32,
    pub get_parameter_id: unsafe extern "system" fn(this: *mut c_void) -> ParamID,
    pub get_point_count: unsafe extern "system" fn(this: *mut c_void) -> i32,
    pub get_point: unsafe extern "system" fn(this: *mut c_void, index: i32, sample_offset: *mut i32, value: *mut ParamValue) -> tresult,
    pub add_point: unsafe extern "system" fn(this: *mut c_void, sample_offset: i32, value: ParamValue, index: *mut i32) -> tresult,
}

#[repr(C)]
struct HostParamValueQueue {
    pub vptr: *const IParamValueQueueVTableLayout,
    ref_count: AtomicI32,
    param_id: ParamID,
    points: Mutex<Vec<(i32, ParamValue)>>,
}

unsafe extern "system" fn pvq_query_interface(this: *mut c_void, iid: *const IID, obj: *mut *mut c_void) -> tresult {
    let check = *iid;
    if check == <dyn IUnknown as ComInterface>::IID || check == <dyn IParamValueQueue as ComInterface>::IID {
        *obj = this;
        pvq_add_ref(this);
        return kResultOk;
    }
    kNoInterface
}

unsafe extern "system" fn pvq_add_ref(this: *mut c_void) -> u32 {
    let s = &*(this as *const HostParamValueQueue);
    s.ref_count.fetch_add(1, Ordering::Relaxed) as u32 + 1
}

unsafe extern "system" fn pvq_release(this: *mut c_void) -> u32 {
    let s = &*(this as *const HostParamValueQueue);
    let val = s.ref_count.fetch_sub(1, Ordering::Relaxed);
    if val == 1 {
        let _ = Box::from_raw(this as *mut HostParamValueQueue);
    }
    val as u32 - 1
}

unsafe extern "system" fn pvq_get_parameter_id(this: *mut c_void) -> ParamID {
    let s = &*(this as *const HostParamValueQueue);
    s.param_id
}

unsafe extern "system" fn pvq_get_point_count(this: *mut c_void) -> i32 {
    let s = &*(this as *const HostParamValueQueue);
    s.points.lock().unwrap().len() as i32
}

unsafe extern "system" fn pvq_get_point(this: *mut c_void, index: i32, sample_offset: *mut i32, value: *mut ParamValue) -> tresult {
    if sample_offset.is_null() || value.is_null() { return kInvalidArgument; }
    let s = &*(this as *const HostParamValueQueue);
    let points = s.points.lock().unwrap();
    if index >= 0 && (index as usize) < points.len() {
        let pt = points[index as usize];
        *sample_offset = pt.0;
        *value = pt.1;
        return kResultOk;
    }
    kInvalidArgument
}

unsafe extern "system" fn pvq_add_point(this: *mut c_void, sample_offset: i32, value: ParamValue, index: *mut i32) -> tresult {
    let s = &*(this as *const HostParamValueQueue);
    let mut points = s.points.lock().unwrap();
    points.push((sample_offset, value));
    if !index.is_null() {
        *index = (points.len() - 1) as i32;
    }
    kResultOk
}

static PVQ_VTBL: IParamValueQueueVTableLayout = IParamValueQueueVTableLayout {
    query_interface: pvq_query_interface,
    add_ref: pvq_add_ref,
    release: pvq_release,
    get_parameter_id: pvq_get_parameter_id,
    get_point_count: pvq_get_point_count,
    get_point: pvq_get_point,
    add_point: pvq_add_point,
};

// ----------------------------------------
// --- IParameterChanges Implementation ---
// ----------------------------------------

#[repr(C)]
struct IParameterChangesVTableLayout {
    pub query_interface: unsafe extern "system" fn(this: *mut c_void, iid: *const IID, obj: *mut *mut c_void) -> tresult,
    pub add_ref: unsafe extern "system" fn(this: *mut c_void) -> u32,
    pub release: unsafe extern "system" fn(this: *mut c_void) -> u32,
    pub get_parameter_count: unsafe extern "system" fn(this: *mut c_void) -> i32,
    pub get_parameter_data: unsafe extern "system" fn(this: *mut c_void, index: i32) -> *mut c_void,
    pub add_parameter_data: unsafe extern "system" fn(this: *mut c_void, id: ParamID, index: *mut i32) -> *mut c_void,
}

#[repr(C)]
struct HostParameterChanges {
    pub vptr: *const IParameterChangesVTableLayout,
    ref_count: AtomicI32,
    queues: Mutex<Vec<*mut HostParamValueQueue>>,
}

unsafe extern "system" fn pc_query_interface(this: *mut c_void, iid: *const IID, obj: *mut *mut c_void) -> tresult {
    let check = *iid;
    if check == <dyn IUnknown as ComInterface>::IID || check == <dyn IParameterChanges as ComInterface>::IID {
        *obj = this;
        pc_add_ref(this);
        return kResultOk;
    }
    kNoInterface
}

unsafe extern "system" fn pc_add_ref(this: *mut c_void) -> u32 {
    let s = &*(this as *const HostParameterChanges);
    s.ref_count.fetch_add(1, Ordering::Relaxed) as u32 + 1
}

unsafe extern "system" fn pc_release(this: *mut c_void) -> u32 {
    let s = &*(this as *const HostParameterChanges);
    let val = s.ref_count.fetch_sub(1, Ordering::Relaxed);
    if val == 1 {
        let queues = s.queues.lock().unwrap();
        for &q in queues.iter() {
            let vptr = (*q).vptr;
            ((*vptr).release)(q as *mut c_void);
        }
        let _ = Box::from_raw(this as *mut HostParameterChanges);
    }
    val as u32 - 1
}

unsafe extern "system" fn pc_get_parameter_count(this: *mut c_void) -> i32 {
    let s = &*(this as *const HostParameterChanges);
    s.queues.lock().unwrap().len() as i32
}

unsafe extern "system" fn pc_get_parameter_data(this: *mut c_void, index: i32) -> *mut c_void {
    let s = &*(this as *const HostParameterChanges);
    let queues = s.queues.lock().unwrap();
    if index >= 0 && (index as usize) < queues.len() {
        return queues[index as usize] as *mut c_void;
    }
    std::ptr::null_mut()
}

unsafe extern "system" fn pc_add_parameter_data(this: *mut c_void, id: ParamID, index: *mut i32) -> *mut c_void {
    let s = &*(this as *const HostParameterChanges);
    let mut queues = s.queues.lock().unwrap();
    
    // Check if queue for this ID already exists
    if let Some(idx) = queues.iter().position(|&q| unsafe { (*q).param_id == id }) {
        if !index.is_null() { *index = idx as i32; }
        return queues[idx] as *mut c_void;
    }
    
    // Create new queue
    let q = Box::new(HostParamValueQueue {
        vptr: &PVQ_VTBL,
        ref_count: AtomicI32::new(1),
        param_id: id,
        points: Mutex::new(Vec::new()),
    });
    let q_ptr = Box::into_raw(q);
    queues.push(q_ptr);
    
    if !index.is_null() { *index = (queues.len() - 1) as i32; }
    q_ptr as *mut c_void
}

static PC_VTBL: IParameterChangesVTableLayout = IParameterChangesVTableLayout {
    query_interface: pc_query_interface,
    add_ref: pc_add_ref,
    release: pc_release,
    get_parameter_count: pc_get_parameter_count,
    get_parameter_data: pc_get_parameter_data,
    add_parameter_data: pc_add_parameter_data,
};

fn create_host_parameter_changes() -> *mut HostParameterChanges {
    let list = Box::new(HostParameterChanges {
        vptr: &PC_VTBL,
        ref_count: AtomicI32::new(1),
        queues: Mutex::new(Vec::new()),
    });
    Box::into_raw(list)
}

// ----------------------------------------
