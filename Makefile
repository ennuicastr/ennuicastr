VOSK_MODEL_VER=en-us-0.15

LIBS=\
     libs/NoSleep.min.js libs/web-streams-ponyfill.js libs/jquery.min.js \
     libs/ennuiboard.min.js libs/vosk.js \
     libs/vosk-model-small-$(VOSK_MODEL_VER).tar.gz

all: ennuicastr.js ennuicastr.min.js \
     protocol.min.js \
     awp/ennuicastr-awp.js awp/ennuicastr-worker.js \
     hotkeys.min.js \
     $(LIBS)

test: ennuicastr-test.js ennuicastr-test.min.js \
      awp/ennuicastr-awp-test.js awp/ennuicastr-worker-test.js \
      hotkeys.min.js \
      $(LIBS)

ennuicastr.js: src/*.ts node_modules/.bin/browserify
	./src/build.js > $@.tmp
	mv $@.tmp $@

ennuicastr.min.js: src/*.ts node_modules/.bin/browserify
	./src/build.js -m > $@.tmp
	mv $@.tmp $@

ennuicastr-test.js: src/*.ts node_modules/.bin/browserify
	./src/build.js > $@

ennuicastr-test.min.js: src/*.ts node_modules/.bin/browserify
	./src/build.js -m > $@

awp/ennuicastr-awp.js: awp/ennuicastr-awp.ts node_modules/.bin/tsc
	./node_modules/.bin/tsc -t es2015 --lib es2017,dom $<

awp/ennuicastr-awp-test.js: awp/ennuicastr-awp.ts node_modules/.bin/tsc
	./node_modules/.bin/tsc -t es2015 --lib es2017,dom $< --outFile $@

awp/ennuicastr-worker.js: awp/ennuicastr-worker.ts node_modules/.bin/tsc
	./node_modules/.bin/tsc --lib es2017,webworker $<

awp/ennuicastr-worker-test.js: awp/ennuicastr-worker.ts node_modules/.bin/tsc
	./node_modules/.bin/tsc --lib es2017,webworker $< --outFile $@

protocol.min.js: protocol.js node_modules/.bin/minify
	./node_modules/.bin/minify --js < $< | cat src/license.js - > $@

hotkeys.min.js: hotkeys.js node_modules/.bin/minify
	./node_modules/.bin/minify --js < $< | cat src/license.js - > $@

node_modules/.bin/browserify:
	npm install

node_modules/.bin/minify: node_modules/.bin/browserify

node_modules/.bin/tsc: node_modules/.bin/browserify

libs/NoSleep.min.js: node_modules/.bin/browserify
	cp node_modules/nosleep.js/dist/NoSleep.min.js $@

libs/web-streams-ponyfill.js: node_modules/.bin/browserify
	cp node_modules/web-streams-polyfill/dist/ponyfill.js $@

libs/jquery.min.js: node_modules/.bin/browserify
	cp node_modules/jquery/dist/jquery.min.js $@

libs/ennuiboard.min.js: node_modules/.bin/browserify
	cp node_modules/ennuiboard/ennuiboard.min.js $@

# NOTE: A newer version of Vosk is actually needed than this one
libs/vosk.js: node_modules/.bin/browserify
	cat src/vosk-browser-license.js node_modules/vosk-browser/dist/vosk.js > $@

libs/vosk-model-small-$(VOSK_MODEL_VER).tar.gz:
	curl -L http://alphacephei.com/vosk/models/vosk-model-small-$(VOSK_MODEL_VER).zip -o libs/vosk-model-small-$(VOSK_MODEL_VER).zip
	cd libs/; \
		unzip vosk-model-small-$(VOSK_MODEL_VER).zip; \
		mv vosk-model-small-$(VOSK_MODEL_VER) model; \
		tar zcf vosk-model-small-$(VOSK_MODEL_VER).tar.gz model/; \
		rm -rf model

clean:
	rm -f ennuicastr.js ennuicastr.min.js protocol.min.js web-streams-ponyfill.js
