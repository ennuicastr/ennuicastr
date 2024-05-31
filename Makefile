PREFIX=inst

LIBAV_VERSION=4.8.6.0.1
LIBSPECBLEACH_VERSION=0.1.7-js2
WEBRTCAEC3_VERSION=0.3.0
VOSK_MODEL_VER=en-us-0.15

OUT=\
    ecloader.js ecloader.min.js \
    ennuicastr.js ennuicastr.min.js \
    protocol.min.js fs/fs.js \
    awp/ennuicastr-worker.js \
    hotkeys.min.js

ENNUICASTR_JS=src/main.js

LIBS=\
    ecdssw.min.js \
    libs/jquery.min.js \
    libs/ennuiboard.min.js libs/localforage.min.js \
    libs/sha512-es.min.js \
    libs/libspecbleach-$(LIBSPECBLEACH_VERSION).js \
    libs/libspecbleach-$(LIBSPECBLEACH_VERSION).asm.js \
    libs/libspecbleach-$(LIBSPECBLEACH_VERSION).wasm.js \
    libs/libspecbleach-$(LIBSPECBLEACH_VERSION).wasm.wasm \
    libs/libspecbleach-$(LIBSPECBLEACH_VERSION).simd.js \
    libs/libspecbleach-$(LIBSPECBLEACH_VERSION).simd.wasm \
    libs/vosk-model-small-$(VOSK_MODEL_VER).tar.gz \
    libs/webrtcaec3-$(WEBRTCAEC3_VERSION).js \
    libs/webrtcaec3-$(WEBRTCAEC3_VERSION).wasm \
    libs/webrtcaec3-$(WEBRTCAEC3_VERSION).wasm.js \
    libs/webrtcvad.js \
    libs/webrtcvad.asm.js \
    libs/webrtcvad.wasm \
    libs/webrtcvad.wasm.js

DATA=\
    bx

EXTRA=\
    index.html ennuicastr3.css protocol.js fs/index.html \
    images/no-echo-white.svg \
    images/normal.svg images/gallery.svg images/studio.svg images/small.svg \
    libav/libav-$(LIBAV_VERSION)-ennuicastr.js \
    libav/libav-$(LIBAV_VERSION)-ennuicastr.asm.js \
    libav/libav-$(LIBAV_VERSION)-ennuicastr.wasm.js \
    libav/libav-$(LIBAV_VERSION)-ennuicastr.wasm.wasm \
    libav/libav-$(LIBAV_VERSION)-ennuicastr.simd.js \
    libav/libav-$(LIBAV_VERSION)-ennuicastr.simd.wasm \
    libs/vosk.js libs/lib-jitsi-meet.7421.js

all: $(addprefix dist/,$(OUT)) $(addprefix dist/,$(LIBS)) $(DATA)

dist/ecloader.js: src/loader.ts node_modules/.bin/tsc
	mkdir -p dist
	./node_modules/.bin/tsc --lib es2015,dom $< --outFile $@

dist/ecloader.min.js: dist/ecloader.js node_modules/.bin/tsc
	./node_modules/.bin/terser < $< > $@

dist/ennuicastr.js: src/main.js src/file-storage-main.js awp/ennuicastr-worker.js
	./node_modules/.bin/rollup -c

dist/ennuicastr.min.js dist/fs/fs.js dist/fs/fs.min.js dist/awp/ennuicastr-worker.js dist/awp/ennuicastr-worker.min.js: dist/ennuicastr.js
	true

src/main.js: src/*.ts node_modules/.bin/tsc
	./node_modules/.bin/tsc --lib es2015,dom src/main.ts

src/file-storage-main.js: src/file-storage-main.ts src/file-storage.ts node_modules/.bin/tsc
	./node_modules/.bin/tsc --lib es2015,dom src/file-storage-main.ts

awp/ennuicastr-worker.js: awp/ennuicastr-worker.ts node_modules/.bin/tsc
	./node_modules/.bin/tsc --lib es2017,webworker $<

dist/protocol.min.js: protocol.js node_modules/.bin/tsc
	./node_modules/.bin/terser < $< | cat meta/license.js - > $@

dist/hotkeys.min.js: hotkeys.js node_modules/.bin/tsc
	./node_modules/.bin/terser < $< | cat meta/license.js - > $@

node_modules/.bin/tsc:
	npm install

dist/ecdssw.min.js: node_modules/.bin/tsc
	mkdir -p dist
	cp node_modules/@ennuicastr/dl-stream/dist/ecdssw.min.js $@

dist/libs/jquery.min.js: node_modules/.bin/tsc
	mkdir -p dist/libs
	cp node_modules/jquery/dist/jquery.min.js $@

dist/libs/ennuiboard.min.js: node_modules/.bin/tsc
	mkdir -p dist/libs
	cp node_modules/ennuiboard/ennuiboard.min.js $@

dist/libs/vosk-model-small-$(VOSK_MODEL_VER).tar.gz:
	mkdir -p dist/libs
	curl -L http://alphacephei.com/vosk/models/vosk-model-small-$(VOSK_MODEL_VER).zip \
		-o dist/libs/vosk-model-small-$(VOSK_MODEL_VER).zip
	cd dist/libs/; \
		unzip vosk-model-small-$(VOSK_MODEL_VER).zip; \
		mv vosk-model-small-$(VOSK_MODEL_VER) model; \
		tar zcf vosk-model-small-$(VOSK_MODEL_VER).tar.gz model/; \
		rm -rf model

dist/libs/localforage.min.js: node_modules/.bin/tsc
	mkdir -p dist/libs
	cp node_modules/localforage/dist/localforage.min.js $@

dist/libs/sha512-es.min.js: node_modules/.bin/tsc
	mkdir -p dist/libs
	cp node_modules/sha512-es/build/sha512-es.min.js $@

dist/libs/libspecbleach-%: node_modules/@ennuicastr/libspecbleach.js/dist/libspecbleach-%
	mkdir -p dist/libs
	cp $< $@

node_modules/@ennuicastr/libspecbleach.js/dist/libspecbleach-%: node_modules/.bin/tsc
	true

dist/libs/webrtcaec3-%: node_modules/@ennuicastr/webrtcaec3.js/dist/webrtcaec3-%
	mkdir -p dist/libs
	cp $< $@

node_modules/@ennuicastr/webrtcaec3.js/dist/webrtcaec3-%: node_modules/.bin/tsc
	true

dist/libs/webrtcvad%: node_modules/@ennuicastr/webrtcvad.js/webrtcvad%
	mkdir -p dist/libs
	cp $< $@

node_modules/@ennuicastr/webrtcvad.js/webrtcvad%: node_modules/.bin/tsc
	true

dist/bx: node_modules/.bin/tsc
	mkdir -p dist
	rm -rf bx bx.tmp
	cp -a node_modules/boxicons bx.tmp
	rm -rf bx.tmp/src
	mv bx.tmp bx

install:
	mkdir -p $(PREFIX)/images $(PREFIX)/awp $(PREFIX)/libav $(PREFIX)/fs \
		$(PREFIX)/libs
	for i in $(OUT) $(LIBS); do \
		install -C -m 0622 dist/$$i $(PREFIX)/$$i; \
	done
	for i in $(EXTRA); do \
		install -C -m 0622 $$i $(PREFIX)/$$i; \
        done
	cp -a bx $(PREFIX)/

clean:
	rm -rf dist/
