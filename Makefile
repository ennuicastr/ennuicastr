MINIFIER=closure-compiler --language_in=ECMASCRIPT5

SRC=src/head.js \
	src/globals.js \
	src/config.js \
	src/log.js \
	src/util.js \
	src/vad.js \
	src/master.js \
	src/rtc.js \
	src/main.js \
	src/tail.js

all: ennuicastr.js ennuicastr.min.js protocol.min.js

ennuicastr.js: $(SRC)
	cat $(SRC) | cat src/license.js - > $@

ennuicastr.min.js: $(SRC)
	cat $(SRC) | $(MINIFIER) | cat src/license.js - > $@

protocol.min.js: protocol.js
	cat $< | $(MINIFIER) | cat src/license.js - > $@

clean:
	rm -f ennuicastr.js ennuicastr.min.js
