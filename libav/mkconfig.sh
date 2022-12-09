#!/bin/sh
set -ex
test -d fragments
mkdir fragments/ennuicastr
echo '--enable-filter=anull' > fragments/ennuicastr/ffmpeg-config.txt
./mkconfig.js ennuicastr '["ogg","webm","opus","ipod","flac","flt","h264","ennuicastr","audio-filters"]'
rm -r fragments/ennuicastr
