all: ennuicastr.js ennuicastr.min.js protocol.min.js hotkeys.min.js web-streams-ponyfill.js

test: ennuicastr-test.js ennuicastr-test.min.js web-streams-ponyfill.js

ennuicastr.js: src/*.ts node_modules/.bin/browserify
	./src/build.js > $@

ennuicastr.min.js: src/*.ts node_modules/.bin/browserify
	./src/build.js -m > $@

ennuicastr-test.js: src/*.ts node_modules/.bin/browserify
	./src/build.js > $@

ennuicastr-test.min.js: src/*.ts node_modules/.bin/browserify
	./src/build.js -m > $@

protocol.min.js: protocol.js node_modules/.bin/minify
	./node_modules/.bin/minify < $< | cat src/license.js - > $@

hotkeys.min.js: hotkeys.js node_modules/.bin/minify
	./node_modules/.bin/minify < $< | cat src/license.js - > $@

node_modules/.bin/browserify:
node_modules/.bin/minify:
	npm install

web-streams-ponyfill.js:
	test -e node_modules/web-streams-polyfill/dist/ponyfill.js || npm install
	cp node_modules/web-streams-polyfill/dist/ponyfill.js $@

clean:
	rm -f ennuicastr.js ennuicastr.min.js protocol.min.js web-streams-ponyfill.js
