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

TEST=\
    ennuicastr-test.js ennuicastr-test.min.js \
    awp/ennuicastr-worker-test.js

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
    libs/webrtcaec3-$(WEBRTCAEC3_VERSION).js \
    libs/webrtcaec3-$(WEBRTCAEC3_VERSION).wasm \
    libs/webrtcaec3-$(WEBRTCAEC3_VERSION).wasm.js

DATA=\
    libs/vosk-model-small-$(VOSK_MODEL_VER).tar.gz \
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

all: $(OUT) $(LIBS) $(DATA)

test: $(TEST) $(LIBS)

ecloader.js: src/loader.ts node_modules/.bin/browserify
	./node_modules/.bin/tsc --lib es2015,dom $< --outFile $@

ecloader.min.js: ecloader.js node_modules/.bin/browserify
	./node_modules/.bin/minify --js < $< > $@

ennuicastr.js: src/*.ts node_modules/.bin/browserify
	./src/build.js > $@.tmp
	mv $@.tmp $@

ennuicastr.min.js: ennuicastr.js node_modules/.bin/browserify
	./node_modules/.bin/minify --js < $< | cat src/license.js - > $@

ennuicastr-test.js: src/*.ts node_modules/.bin/browserify
	./src/build.js > $@

ennuicastr-test.min.js: ennuicastr-test.js node_modules/.bin/browserify
	./node_modules/.bin/minify --js < $< | cat src/license.js - > $@

sw.js: src/sw.ts node_modules/.bin/browserify
	./node_modules/.bin/tsc --lib es2015,dom $< --outFile $@

fs/fs.js: src/file-storage-main.ts src/file-storage.ts node_modules/.bin/browserify
	./src/build.js $< -s EnnuicastrFileStorage > $@

awp/ennuicastr-worker.js: awp/ennuicastr-worker.ts node_modules/.bin/tsc
	./node_modules/.bin/tsc \
		--lib es2017,webworker --esModuleInterop true \
		$<
	( \
		cat node_modules/@ennuicastr/webrtcvad.js/webrtcvad.js ; \
		grep -v __esModule $@ \
	) > $@.tmp
	mv $@.tmp $@

awp/ennuicastr-worker-test.js: awp/ennuicastr-worker.ts node_modules/.bin/tsc
	./node_modules/.bin/tsc --lib es2017,webworker $< --outfile $@.tmp
	cat node_modules/@ennuicastr/webrtcvad.js/webrtcvad.js $@.tmp > $@
	rm -f $@.tmp

protocol.min.js: protocol.js node_modules/.bin/minify
	./node_modules/.bin/minify --js < $< | cat src/license.js - > $@

hotkeys.min.js: hotkeys.js node_modules/.bin/minify
	./node_modules/.bin/minify --js < $< | cat src/license.js - > $@

node_modules/.bin/browserify:
	npm install

node_modules/.bin/minify: node_modules/.bin/browserify

node_modules/.bin/tsc: node_modules/.bin/browserify

ecdssw.min.js: node_modules/.bin/browserify
	cp node_modules/@ennuicastr/dl-stream/dist/ecdssw.min.js $@

libs/jquery.min.js: node_modules/.bin/browserify
	cp node_modules/jquery/dist/jquery.min.js $@

libs/ennuiboard.min.js: node_modules/.bin/browserify
	cp node_modules/ennuiboard/ennuiboard.min.js $@

libs/vosk-model-small-$(VOSK_MODEL_VER).tar.gz:
	curl -L http://alphacephei.com/vosk/models/vosk-model-small-$(VOSK_MODEL_VER).zip -o libs/vosk-model-small-$(VOSK_MODEL_VER).zip
	cd libs/; \
		unzip vosk-model-small-$(VOSK_MODEL_VER).zip; \
		mv vosk-model-small-$(VOSK_MODEL_VER) model; \
		tar zcf vosk-model-small-$(VOSK_MODEL_VER).tar.gz model/; \
		rm -rf model

libs/localforage.min.js: node_modules/.bin/browserify
	cp node_modules/localforage/dist/localforage.min.js $@

libs/sha512-es.min.js: node_modules/.bin/browserify
	cp node_modules/sha512-es/build/sha512-es.min.js $@

libs/libspecbleach-%: node_modules/@ennuicastr/libspecbleach.js/dist/libspecbleach-%
	cp $< $@

node_modules/@ennuicastr/libspecbleach.js/dist/libspecbleach-%: node_modules/.bin/browserify
	true

libs/webrtcaec3-%: node_modules/@ennuicastr/webrtcaec3.js/dist/webrtcaec3-%
	cp $< $@

node_modules/@ennuicastr/webrtcaec3.js/dist/webrtcaec3-%: node_modules/.bin/browserify
	true

Fork-Awesome-$(FKA_VERSION).tar.gz:
	curl -L https://github.com/ForkAwesome/Fork-Awesome/archive/refs/tags/$(FKA_VERSION).tar.gz -o $@

bx: node_modules/.bin/browserify
	rm -rf bx bx.tmp
	cp -a node_modules/boxicons bx.tmp
	rm -rf bx.tmp/src
	mv bx.tmp bx

install:
	mkdir -p $(PREFIX)/images $(PREFIX)/awp $(PREFIX)/libav $(PREFIX)/fs \
		$(PREFIX)/libs
	for i in $(OUT) $(LIBS) $(EXTRA); do \
		install -C -m 0622 $$i $(PREFIX)/$$i; \
        done
	for i in $(TEST); do \
		install -C -m 0622 $$i $(PREFIX)/$$i || true; \
        done
	cp -a bx $(PREFIX)/

clean:
	rm -f $(OUT) $(TEST) $(LIBS)

distclean: clean
	rm -f $(DATA)
