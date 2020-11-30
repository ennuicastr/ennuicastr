declare var LibAV: any, __filename: string;

LibAV = {nolibavworker: true, base: "../libav"};
__filename = "../libav/libav-2.2d.4.3.1-ennuicastr-webm.js"; // To "trick" wasm loading
importScripts(__filename);

onmessage = function(ev) {
    var msg = ev.data;
    switch (msg.c) {
        case "encoder":
            doEncoder(msg);
            break;

        case "filter":
            doFilter(msg);
            break;
    }
}

// Encode with libav
function doEncoder(msg) {
    var inPort: MessagePort = msg.port;
    var inSampleRate: number = msg.inSampleRate || 48000;
    var outSampleRate: number = msg.outSampleRate || 48000;
    var format: string = msg.format || "opus";
    var channelLayout: number = msg.channelLayout || 4;
    var channelCount: number = msg.channelCount || 1;
    var p: Promise<unknown> = Promise.all([]);
    var pts = 0;

    var libav: any;
    var encOptions: any = {
        sample_rate: outSampleRate,
        frame_size: outSampleRate * 20 / 1000,
        channel_layout: 4,
        channels: 1
    };

    var codec, c, frame, pkt;
    var filter_graph, buffersrc_ctx, buffersink_ctx;

    // Load libav
    return LibAV.LibAV({noworker: true}).then(la => {
        libav = la;

        if (format === "flac") {
            encOptions.sample_fmt = libav.AV_SAMPLE_FMT_S32;
        } else {
            encOptions.sample_fmt = libav.AV_SAMPLE_FMT_FLT;
            encOptions.bit_rate = 128000;
        }

        // Create the encoder
        return libav.ff_init_encoder((format==="flac")?"flac":"libopus", encOptions, 1, outSampleRate);

    }).then(ret => {
        codec = ret[0];
        c = ret[1];
        frame = ret[2];
        pkt = ret[3];
        encOptions.frame_size = ret[4];

        // Create the filter
        return libav.ff_init_filter_graph("aresample", {
            sample_rate: inSampleRate,
            sample_fmt: libav.AV_SAMPLE_FMT_FLTP,
            channels: channelCount,
            channel_layout: channelLayout
        }, {
            sample_rate: encOptions.sample_rate,
            sample_fmt: encOptions.sample_fmt,
            channel_layout: 4,
            frame_size: encOptions.frame_size
        });

    }).then(ret => {
        filter_graph = ret[0];
        buffersrc_ctx = ret[1];
        buffersink_ctx = ret[2];

        // Now we're prepared for input
        inPort.onmessage = onmessage;

    }).catch(console.error);

    function onmessage(ev: MessageEvent) {
        // Put it in libav format
        var msg = ev.data;
        var data = msg.d;
        while (data.length < channelCount)
            data = data.concat(data);
        var frames = [{
            data: data,
            channels: channelCount,
            channel_layout: channelLayout,
            format: libav.AV_SAMPLE_FMT_FLTP,
            pts: pts,
            sample_rate: inSampleRate
        }];
        pts += data[0].length;

        p = p.then(() => {
            // Filter
            return libav.ff_filter_multi(buffersrc_ctx, buffersink_ctx, frame, frames);

        }).then(frames => {
            // Encode
            if (frames.length === 0)
                return [];
            return libav.ff_encode_multi(c, frame, pkt, frames);

        }).then(encPackets => {
            if (encPackets.length === 0)
                return;

            // They only need the raw data
            var packets = [];
            for (var pi = 0; pi < encPackets.length; pi++)
                packets.push(encPackets[pi].data);

            // Send the encoded packets to the *host*
            var end = Date.now();
            postMessage({c: "packets", t: end - msg.t, d: packets});

        }).catch(console.error);
    }
}

// Do a live filter
function doFilter(msg) {
}
