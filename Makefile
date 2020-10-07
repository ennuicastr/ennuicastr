MINIFIER=closure-compiler --language_in=ECMASCRIPT5

SRC=src/head.js \
	src/globals.js \
	src/config.js \
	src/audio.js \
	src/chat.js \
	src/compression.js \
	src/log.js \
	src/master.js \
	src/menu.js \
	src/net.js \
	src/ptt.js \
	src/rtc.js \
	src/safari.js \
	src/ui.js \
	src/util.js \
	src/vad.js \
	src/video-record.js \
	src/main.js \
	src/tail.js

all: ennuicastr.js ennuicastr.min.js protocol.min.js hotkeys.min.js web-streams-ponyfill.js

test: ennuicastr-test.js ennuicastr-test.min.js web-streams-ponyfill.js

ennuicastr.js: $(SRC)
	cat $(SRC) | cat src/license.js - > $@

ennuicastr.min.js: $(SRC)
	cat $(SRC) | $(MINIFIER) | cat src/license.js - > $@

ennuicastr-test.js: $(SRC)
	cat $(SRC) | cat src/license.js - > $@

ennuicastr-test.min.js: $(SRC)
	cat $(SRC) | $(MINIFIER) | cat src/license.js - > $@

protocol.min.js: protocol.js
	cat $< | $(MINIFIER) | cat src/license.js - > $@

hotkeys.min.js: hotkeys.js
	cat $< | $(MINIFIER) | cat src/license.js - > $@

web-streams-ponyfill.js:
	test -e node_modules/web-streams-polyfill/dist/ponyfill.js || npm install web-streams-polyfill
	cp node_modules/web-streams-polyfill/dist/ponyfill.js $@

clean:
	rm -f ennuicastr.js ennuicastr.min.js web-streams-ponyfill.js
