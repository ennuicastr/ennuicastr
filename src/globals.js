/*
 * Copyright (c) 2018-2020 Yahweasel
 *
 * Permission to use, copy, modify, and/or distribute this software for any
 * purpose with or without fee is hereby granted, provided that the above
 * copyright notice and this permission notice appear in all copies.
 *
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
 * WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
 * MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY
 * SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
 * WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION
 * OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN
 * CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
 */

// Basic DOM stuff
var dce = document.createElement.bind(document);
var gebi = document.getElementById.bind(document);
var log = gebi("log");

// For feature selection in audio
var plzyes = {ideal: true};
var plzno = {ideal: false};

// Short name for our protocol
var prot = EnnuiCastrProtocol;

// Opus zero packet, will be replaced with FLAC's version if needed
var zeroPacket = new Uint8Array([0xF8, 0xFF, 0xFE]);

// Configuration, which will be filled in by loading code
var config;

/* We have multiple connections to the server:
 * One for pings,
 * one to send data, and
 * if we're the master, one for master communication */
var pingSock = null;
var dataSock = null;
var masterSock = null;

// We connect assuming our mode is not-yet-recording
var mode = prot.mode.init;

// There are a lot of intermediate steps to getting audio from point A to point B
var userMedia = null; // The microphone input for recording
var userMediaRTC = null; // The microphone input for RTC
var userMediaAvailableEvent = new EventTarget(); // "ready" fires when userMedia and userMediaRTC are ready
var ac = null; // The audio context for our scripts
var fileReader = null; // Used to transfer Opus data from the built-in encoder
var mediaRecorder = null; // The built-in media recorder, on browsers which support encoding to Ogg Opus
var libavEncoder = null; // If using libav.js to encode

// If we're flushing our buffers, this will be a timeout to re-check
var flushTimeout = null;

// Our input sample rate
var sampleRate = 48000;

// Our RTC peer connections
var rtcConnections = {};

// WebRTCVAD's raw output
var rawVadOn = false;

// Warmup for rawVadOn to swap on
var rawVadCt = 0;

// VAD output after our cooldown
var vadOn = false;

// Number of milliseconds to run the VAD for before/after talking
var vadExtension = 2000;

// When we're not sending real data, we have to send a few (arbitrarily, 3) empty frames
var sentZeroes = 999;

/* To help with editing by sending a clean silence sample, we send the
 * first few (arbitrarily, 8) seconds of VAD-off silence */
var sendSilence = 400;

// The data used by both the level-based VAD and display
var waveData = [];
var waveVADs = [];

var waveVADColorSets = {
    "sv": ["#000", "#753", "#730", "#a30"],
    "sc": ["#000", "#730", "#730", "#a30"],
    "rv": ["#000", "#aaa", "#073", "#0a3"],
    "rc": ["#000", "#073", "#073", "#0a3"]
};

var waveVADColors = waveVADColorSets.sv;

// The display canvas and data
var waveCanvas = null;
var waveWatcher = null;
var waveRotate = false;

// If we're in master mode, master UI elements
var masterUI = {};

// Our start time is in local ticks, and our offset is updated every so often
var startTime = 0;
var timeOffset = null;

/* So that the time offset doesn't jump all over the place, we adjust it
 * *slowly*. This is the target time offset */
var targetTimeOffset = null;

// And this is the amount to adjust it per frame (1%)
var timeOffsetAdjPerFrame = 0.0002;

/* We keep track of the last time we successfully encoded data for
 * transfer, to determine if anything's gone wrong */
var lastSentTime = 0;

// The delays on the pongs we've received back
var pongs = [];

// The current blobs waiting to be read
var blobs = [];

// The current ArrayBuffers of data to be handled
var data = [];

// The Opus or FLAC packets to be handled. Format: [granulePos, data]
var packets = [];
