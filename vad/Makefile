CC=emcc
CFLAGS=-O3
EFLAGS=\
	--memory-init-file 0 --post-js post.js \
	-s "EXPORT_NAME='WebRtcVad'" \
	-s "EXPORTED_FUNCTIONS=['_WebRtcVad_Create', '_WebRtcVad_Init', '_WebRtcVad_Free', '_WebRtcVad_set_mode', '_WebRtcVad_Process', '_malloc', '_free']" \
	-s "EXTRA_EXPORTED_RUNTIME_METHODS=['cwrap']" \
	-s MODULARIZE_INSTANCE=1 \
	-Iwebrtc \
	-DWEBRTC_POSIX
WEBRTC_SRC= \
	stubs.c \
	webrtc/common_audio/vad/webrtc_vad.c \
	webrtc/common_audio/signal_processing/spl_init.c \
	webrtc/common_audio/signal_processing/cross_correlation.c \
	webrtc/common_audio/signal_processing/downsample_fast.c \
	webrtc/common_audio/signal_processing/min_max_operations.c \
	webrtc/common_audio/signal_processing/vector_scaling_operations.c \
	webrtc/common_audio/vad/vad_core.c \
	webrtc/common_audio/signal_processing/division_operations.c \
	webrtc/common_audio/signal_processing/resample_48khz.c \
	webrtc/common_audio/signal_processing/resample_by_2_internal.c \
	webrtc/common_audio/signal_processing/resample_fractional.c \
	webrtc/common_audio/vad/vad_filterbank.c \
	webrtc/common_audio/signal_processing/energy.c \
	webrtc/common_audio/signal_processing/get_scaling_square.c \
	webrtc/common_audio/vad/vad_sp.c \
	webrtc/common_audio/vad/vad_gmm.c
META=license.js post.js

all: vad.js vad.wasm.js

vad.js: $(WEBRTC_SRC) $(META)
	$(CC) $(CFLAGS) $(EFLAGS) $(WEBRTC_SRC) -s WASM=0 -o $@
	cat license.js $@ > $@.tmp
	mv $@.tmp $@

vad.wasm.js: $(WEBRTC_SRC) $(META)
	$(CC) $(CFLAGS) $(EFLAGS) $(WEBRTC_SRC) -o $@
	cat license.js $@ > $@.tmp
	mv $@.tmp $@

clean:
	rm -f vad.js vad.wasm.js vad.wasm.wasm
