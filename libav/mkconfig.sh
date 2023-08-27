#!/bin/sh
set -ex
test -d fragments
./mkconfig.js ennuicastr '[
    "format-ogg","format-webm", "format-mp4",
    "codec-libopus", "codec-flac","codec-pcm_f32le",
    "decoder-h264",
    "bsf-vp9_metadata",
    "audio-filters","swscale"
]'
