all: ennuicastr.js ennuicastr.min.js protocol.min.js hotkeys.min.js web-streams-ponyfill.js

test: ennuicastr-test.js ennuicastr-test.min.js web-streams-ponyfill.js

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

protocol.min.js: protocol.js node_modules/.bin/minify
	./node_modules/.bin/minify --js < $< | cat src/license.js - > $@

hotkeys.min.js: hotkeys.js node_modules/.bin/minify
	./node_modules/.bin/minify --js < $< | cat src/license.js - > $@

node_modules/.bin/browserify:
	npm install

node_modules/.bin/minify: node_modules/.bin/browserify

web-streams-ponyfill.js: node_modules/.bin/browserify
	cp node_modules/web-streams-polyfill/dist/ponyfill.js $@

clean:
	rm -f ennuicastr.js ennuicastr.min.js protocol.min.js web-streams-ponyfill.js
