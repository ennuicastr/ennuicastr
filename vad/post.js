WebRtcVad = {
    Module: Module,
    Create: Module.cwrap("WebRtcVad_Create", "number", []),
    Init: Module.cwrap("WebRtcVad_Init", "number", ["number"]),
    Free: Module.cwrap("WebRtcVad_Free", null, ["number"]),
    set_mode: Module.cwrap("WebRtcVad_set_mode", "number", ["number"]),
    Process: Module.cwrap("WebRtcVad_Process", "number", ["number", "number", "number", "number"]),
    malloc: Module.cwrap("malloc", "number", ["number"]),
    free: Module.cwrap("free", null, ["number"]),
    heap: Module.HEAPU8
};
