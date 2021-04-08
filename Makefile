all: ennuicastr.js ennuicastr.min.js \
     protocol.min.js \
     awp/ennuicastr-awp.js awp/ennuicastr-worker.js \
     hotkeys.min.js NoSleep.min.js web-streams-ponyfill.js

test: ennuicastr-test.js ennuicastr-test.min.js \
      awp/ennuicastr-awp-test.js awp/ennuicastr-worker-test.js \
      NoSleep.min.js web-streams-ponyfill.js

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
	./node_modules/.bin/tsc -t es2015 --lib es2015,dom $<

awp/ennuicastr-awp-test.js: awp/ennuicastr-awp.ts node_modules/.bin/tsc
	./node_modules/.bin/tsc -t es2015 --lib es2015,dom $< --outFile $@

awp/ennuicastr-worker.js: awp/ennuicastr-worker.ts node_modules/.bin/tsc
	./node_modules/.bin/tsc --lib es2015,webworker $<

awp/ennuicastr-worker-test.js: awp/ennuicastr-worker.ts node_modules/.bin/tsc
	./node_modules/.bin/tsc --lib es2015,webworker $< --outFile $@

protocol.min.js: protocol.js node_modules/.bin/minify
	./node_modules/.bin/minify --js < $< | cat src/license.js - > $@

hotkeys.min.js: hotkeys.js node_modules/.bin/minify
	./node_modules/.bin/minify --js < $< | cat src/license.js - > $@

node_modules/.bin/browserify:
	npm install

node_modules/.bin/minify: node_modules/.bin/browserify

node_modules/.bin/tsc: node_modules/.bin/browserify

NoSleep.min.js: node_modules/.bin/browserify
	cp node_modules/nosleep.js/dist/NoSleep.min.js $@

web-streams-ponyfill.js: node_modules/.bin/browserify
	cp node_modules/web-streams-polyfill/dist/ponyfill.js $@

clean:
	rm -f ennuicastr.js ennuicastr.min.js protocol.min.js web-streams-ponyfill.js
