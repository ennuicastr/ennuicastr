Module.Create = Module.cwrap("WebRtcVad_Create", "number", []);
Module.Init = Module.cwrap("WebRtcVad_Init", "number", ["number"]);
Module.Free = Module.cwrap("WebRtcVad_Free", null, ["number"]);
Module.set_mode = Module.cwrap("WebRtcVad_set_mode", "number", ["number"]);
Module.Process = Module.cwrap("WebRtcVad_Process", "number", ["number", "number", "number", "number"]);
Module.malloc = Module.cwrap("malloc", "number", ["number"]);
Module.free = Module.cwrap("free", null, ["number"]);
Module.heap = Module.HEAPU8;
