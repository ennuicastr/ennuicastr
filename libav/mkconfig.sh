#!/bin/sh
set -ex
test -d fragments
./mkconfig.js ennuicastr '[
    "format-ogg","format-webm", "format-mp4",
    "codec-libopus", "codec-flac","codec-pcm_f32le",
    "parser-vp8", "libvpx", "decoder-libvpx_vp8",
    "parser-h264", "bsf-h264_metadata",
    "parser-vp9", "bsf-vp9_metadata",
    "audio-filters","swscale"
]'
