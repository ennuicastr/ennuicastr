/*
 * Copyright (c) 2020 Yahweasel
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

/* NOTE: The functionality in this file relates to dynamic range compression,
 * NOT digital audio compression */

// Create a compressor and gain node
function createCompressor(idx, ac, input) {
    // Destroy any previous compressor
    var cur = rtcCompression.compressors[idx];
    if (cur)
        destroyCompressor(idx);

    // Make sure we actually have gain calculated
    if (!rtcCompression.gain.gain)
        compressorCalculateGain();

    var ret = {
        ac: ac,
        inputStream: input,
        input: null,

        // Compressor node
        compressor: null,

        // Gain node
        gain: null
    };

    // Create our input
    var i = ret.input = ac.createMediaStreamSource(input);

    // Create our compressor
    var c = ret.compressor = ac.createDynamicsCompressor();
    for (var k in rtcCompression.compressor)
        c[k].value = rtcCompression.compressor[k];

    setInterval(function() {
        console.log(c.reduction);
    }, 100);

    // Create our gain node
    var g = ret.gain = ac.createGain();
    g.gain.value = rtcCompression.gain.volume * rtcCompression.gain.gain;

    // Connect it all
    i.connect(c);
    c.connect(g);
    g.connect(ac.destination);

    var cs = rtcCompression.compressors;
    while (cs.length <= idx)
        cs.push(null);
    cs[idx] = ret;

    return ret;
}

// Destroy a compressor
function destroyCompressor(idx) {
    var com = rtcCompression.compressors[idx];
    if (!com)
        return;
    rtcCompression.compressors[idx] = null;

    com.input.disconnect(com.compressor);
    com.compressor.disconnect(com.gain);
    com.gain.disconnect(com.ac.destination);
}

// Calculate our correct gain based on the compressor and gain values set
function compressorCalculateGain() {
    var c = rtcCompression.compressor;
    var g = rtcCompression.gain;

    /* The basic idea is that the compressor is going to reduce the dynamic
     * range from ((c.threshold+c.knee) to 0) to ((c.threshold+c.knee) to
     * (range/c.ratio)). That means that the highest volume is now, for
     * instance, -45dB with usual settings. We are then going to calculate the
     * gain to increase that to g.target. */
    var min = c.threshold + c.knee;
    var max = min - (min/c.ratio);
    var gain = 10 * Math.log10(max/g.target);
    g.gain = gain;
}

/* If we've changed the targets (e.g. to turn off compression), reset all the
 * nodes */
function compressorChanged() {
    var c = rtcCompression.compressor;
    var g = rtcCompression.gain;

    // Make sure we actually KNOW our target
    if (!g.gain)
        compressorCalculateGain();

    // Then apply it all
    rtcCompression.compressors.forEach(function(co) {
        if (!co) return;
        for (var k in c)
            co.compressor[k].setTargetAtTime(c[k], 0, 0.03);
        co.gain.gain.setTargetAtTime(g.gain * g.volume, 0, 0.03);
    });
}
