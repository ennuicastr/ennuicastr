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

var mkvdemuxjs = (function(mkvdemuxjs) {
    // A few IDs we repeat, as "globals"
    var ID_CLUSTER = 0x1f43b675;
    var ID_TRACKENTRY = 0xae;

    // The main MKV demuxer type
    function MkvDemux() {
        // Queue of data to be demuxed
        this.queue = [];
        this.peekHi = 0;
        this.peekLo = 0;

        // Our overall position in the document
        this.pos = 0;

        // Our entire context
        this.context = [];

        // Our current context
        this.block = null;

        // Extra info used during demuxing
        this.ex = {};
    }

    MkvDemux.prototype = {
        // Push ArrayBuffer data in the queue
        push: function(data) {
            this.queue.push(data);
        },

        // Peek this many bytes from the queue
        peek: function(count) {
            if (this.queue.length <= this.peekHi)
                return null;

            // Special case for peeking at the beginning
            var q = this.queue[this.peekHi];
            if (this.peekLo === 0 && q.byteLength >= count) {
                this.peekLo += count;
                if (this.peekLo >= q.byteLength) {
                    this.peekHi++;
                    this.peekLo = 0;
                }
                return q;
            }

            // Special case for peeking with enough data left
            if (q.byteLength >= this.peekLo + count) {
                var ret = new Uint8Array(q).slice(this.peekLo, this.peekLo + count);
                this.peekLo += count;
                if (this.peekLo >= q.byteLength) {
                    this.peekHi++;
                    this.peekLo = 0;
                }
                return ret.buffer;
            }

            // Otherwise, construct our return
            var ret = new Uint8Array(count);
            ret.set(new Uint8Array(q).slice(this.peekLo));
            var pos = q.byteLength - this.peekLo;
            var left = count - pos;
            var i = this.peekHi + 1;
            while (left) {
                if (i >= this.queue.length) return null;

                // Pull out another buffer
                var next = new Uint8Array(this.queue[i++]);
                if (next.length >= left) {
                    // This has enough to fill out the remainder
                    if (next.length === left) {
                        // Exactly enough
                        ret.set(next, pos);
                        this.peekHi = i + 1;
                        this.peekLo = 0;
                        left = 0;

                    } else {
                        // More than enough
                        ret.set(next.slice(0, left), pos);
                        this.peekHi = i;
                        this.peekLo = left;
                        left = 0;

                    }

                } else {
                    // Not enough, need the whole thing
                    ret.set(next, pos);
                    left -= next.length;
                    pos += next.length;

                }
            }
            return ret.buffer;
        },

        // Commit whatever we've peeked
        commit: function() {
            // Remove entire elements
            while (this.peekHi) {
                this.pos += this.queue[0].byteLength;
                this.queue.shift();
                this.peekHi--;
            }

            // And truncate the last one
            if (this.peekLo) {
                this.pos += this.peekLo;
                var nq = new Uint8Array(this.queue[0]).slice(this.peekLo);
                if (nq.length === 0)
                    this.queue.shift();
                else
                    this.queue[0] = nq.buffer;
                this.peekLo = 0;
            }

            // If we've moved beyond any elements, pop them from our context
            while (this.context.length && this.context[this.context.length-1].end <= this.pos)
                this.context.pop();
            if (this.context.length)
                this.block = this.context[this.context.length-1];
            else
                this.block = null;
        },

        // Save our peek position
        savePeek: function() {
            return {hi: this.peekHi, lo: this.peekLo};
        },

        // Restore our peek position
        restorePeek: function(from) {
            this.peekHi = from.hi;
            this.peekLo = from.lo;
        },

        // Peek a variable-sized int (VINT)
        peekVint: function(keepMarker) {
            /* variable-size ints have a header that describes the width, then
             * the data across multiple bytes */
            var pre = this.savePeek();
            var header = this.peek(1);
            if (header === null)
                return null;
            header = new Uint8Array(header)[0];

            // Determine how many bytes are represented by this header
            var bytes = 1;
            while (!(header & 0x80)) {
                bytes++;
                header = (header << 1) & 0xFF;
            }

            // Get rid of the 1 bit
            header &= 0x7F;
            header >>>= bytes-1;

            // Now read in the whole thing
            this.restorePeek(pre);
            var whole = this.peek(bytes);
            if (whole === null)
                return null;

            // Then convert it
            whole = new Uint8Array(whole).slice(0, bytes);
            if (!keepMarker)
                whole[0] = header;
            var ret = 0;
            for (var i = 0; i < whole.length; i++) {
                ret *= 0x100;
                ret += whole[i];
            }

            return ret;
        },

        // Read an EBML header
        readEBMLHeader: function() {
            var pre = this.savePeek();
            var prePos = this.pos;

            // ID
            var id = this.peekVint(true);
            if (id === null)
                return null;

            var length;

            // Check for the special case of unknown length, which we just ignore in our context
            var pre2 = this.savePeek();
            var x = this.peek(1);
            if (x === null) {
                this.restorePeek(pre);
                return null;
            }
            x = new Uint8Array(x)[0];
            if (x === 0xBF) {
                // Unknown length
                length = -1;
            } else {
                // Normal VINT
                this.restorePeek(pre2);
                length = this.peekVint();
                if (length === null) {
                    this.restorePeek(pre);
                    return null;
                }
            }

            // Update our context
            this.commit();
            var ret = new EBML(id, length, prePos, this.pos);
            if (length >= 0) {
                this.context.push(ret);
                this.block = ret;
            }

            return ret;
        },

        // Read the entire content of the current EBML element
        readEBMLBody: function() {
            if (this.block.length === 0) {
                this.context.pop();
                if (this.context.length)
                    this.block = this.context[this.context.length-1];
                else
                    this.block = null;
                return null;
            }

            // Read it in
            var hdr = this.block;
            var len = hdr.end - this.pos;
            var ret = this.peek(len);
            if (ret === null)
                return null;

            // Read it, so commit
            this.commit();
            return ret;
        },

        // Read the content of the current EBML element as an unsigned integer
        readUInt: function() {
            var len = this.block.length;

            // Read it in
            var val = this.readEBMLBody();
            if (len === 0)
                return 0;
            if (val === null)
                return null;

            // Convert it
            val = new DataView(val);
            switch (len) {
                case 1:
                    return val.getUint8(0);
                case 2:
                    return val.getUint16(0);
                case 4:
                    return val.getUint32(0);

                default:
                    var ret = 0;
                    val = new Uint8Array(val.buffer);
                    for (var i = 0; i < len; i++) {
                        ret *= 0x100;
                        ret += val[i];
                    }
                    return ret;
            }
        },

        // Read the content of the current EBML element as a float
        readFloat: function() {
            var len = this.block.length;

            // Read it in
            var val = this.readEBMLBody();
            if (len === 0)
                return 0;
            if (val === null)
                return null;

            // Convert it
            val = new DataView(val);
            if (len === 4)
                return val.getFloat32(0);
            else if (len === 8)
                return val.getFloat64(0);
            else
                return 0;
        },

        /* The main demuxer. Can return one of several structures:
         * If there's not enough data to demux, returns null.
         * If it received a track entry, returns
         *  {track: {...}}
         * If it received packets, returns
         *  {frames: array({data: [data], track: [track number], timestamp: [timestamp]})}
         * If it received anything else, returns the EBML context
         */
        demux: function() {
            var el;

            while (true) {
                // Figure out our current context
                if (!this.context.length)
                    this.readEBMLHeader();
                if (!this.context.length)
                    return null;
                el = this.block;

                // We should know what to read based on that context
                switch (el.id) {
                    case 0x1a45dfa3: // EBML header
                    case 0x114d9b74: // SeekHead
                    case 0x1549a966: // Info
                    case 0x1254c367: // Tags
                    case 0x75a2: // DiscardPadding
                    case 0xec: // ???
                    case 0xbf: // ???
                        // Elements we don't care about. Skip them.
                        var ct = this.readEBMLBody();
                        if (ct === null)
                            return null;
                        el.ex.content = ct;
                        return el;

                    case 0x18538067: // Segment
                    case 0x1654ae6b: // Tracks
                    case ID_CLUSTER: // Cluster
                    case 0xa0: // BlockGroup
                        // Surrounding elements we need to dig into
                        if (this.readEBMLHeader() === null)
                            return null;
                        this.ex = {};
                        break;

                    case ID_TRACKENTRY: // TrackEntry
                        // A track description. Read it fully.
                        return this.readTrackEntry();

                    case 0xe7: // Timestamp (in cluster)
                        var val = this.readUInt();
                        if (val === null)
                            return null;
                        this.ex.clusterTimestamp = val;
                        break;

                    case 0xa1: // Block
                    case 0xa3: // SimpleBlock
                        return this.decodeBlock();

                    default:
                        // We don't know what this is!
                        var ct = this.readEBMLBody();
                        if (ct === null)
                            return null;
                        console.log("Unrecognized element " + el.id.toString(16) + " at " + el.start.toString(16) + " to " + el.end.toString(16));
                        console.log("Context:");
                        for (var i = 0; i < this.context.length; i++)
                            console.log("  " + this.context[i].id.toString(16));
                        el.ex.content = ct;
                        return el;
                }
            }
        },

        // Read and decode a track entry
        readTrackEntry: function() {
            var te = this.block;
            var len = te.end - this.pos;

            // Make sure it's all here
            var pre = this.savePeek();
            if (this.peek(len) === null)
                return null;
            this.restorePeek(pre);

            var ret = {track: {}};

            // Now read in each of the parts
            while (this.block === te) {
                var hdr = this.readEBMLHeader();
                if (hdr === null)
                    return null;

                switch (hdr.id) {
                    case 0x9c: // FlagLacing
                    case 0x22b59c: // Language
                    case 0x56bb: // SeekPreRoll
                    case 0x63a2: // CodecPrivate
                        // Irrelevant for us, just skip it
                        this.readEBMLBody();
                        break;

                    case 0xe1: // Audio
                        // We need the actual body of this
                        this.context.pop();
                        this.block = te;
                        break;

                    case 0xd7: // TrackNumber
                        ret.track.number = this.readUInt();
                        break;

                    case 0x73c5: // TrackUID
                        ret.track.uid = this.readUInt();
                        break;

                    case 0x86: // CodecID
                        ret.track.codec = this.readUInt();
                        break;

                    case 0x56aa: // CodecDelay
                        ret.track.codecDelay = this.readUInt() / 1000000000;
                        break;

                    case 0x83: // CodecType
                        var ct = ret.track.codecType = this.readUInt();
                        var t = "unknown";
                        switch (ct) {
                            case 1:
                                t = "video";
                                break;

                            case 2:
                                t = "audio";
                                break;
                        }
                        ret.track.type = t;
                        break;

                    case 0x9f: // Audio:Channels
                        ret.track.channels = this.readUInt();
                        break;

                    case 0xb5: // Audio:SamplingFrequency
                        ret.track.sampleRate = this.readFloat();
                        break;

                    case 0x6264: // Audio:BitDepth
                        ret.track.bitDepth = this.readUInt();
                        break;

                    default:
                        console.log("Unrecognized track entry component " + hdr.id.toString(16));
                        this.readEBMLBody();
                }
            }

            return ret;
        },

        // Decode a single Block or SimpleBlock
        decodeBlock: function() {
            var len = this.block.length;
            var cont = this.readEBMLBody();
            if (cont === null)
                return null;
            cont = new DataView(cont);

            // Surrounding data
            var ret = {};
            var clusterTimestamp = this.ex.clusterTimestamp;
            if (!clusterTimestamp)
                clusterTimestamp = 0;

            // Byte 0: Track number
            var track = cont.getUint8(0);
            if (!(track & 0x80))
                console.log("ERROR: Track #s greater than 127 are not supported!");
            track &= 0x7F;

            // Bytes 1 and 2: Timecode offset
            var timeOff = cont.getInt16(1);
            var timestamp = (clusterTimestamp + timeOff) / 1000;

            // Byte 3: Flags
            var flags = cont.getUint8(3);
            if ((flags & 0x6) !== 0)
                console.log("ERROR: Lacing is not supported!");

            // Rest: The actual data
            var frame = {
                data: new Uint8Array(cont.buffer).slice(4, len).buffer,
                track: track,
                timestamp: timestamp
            };
            ret.frames = [frame];

            return ret;
        }
    };

    // An EBML "tag"
    function EBML(id, length, start, bodyStart) {
        this.id = id;
        this.length = length;
        this.start = start;
        this.bodyStart = bodyStart;
        if (length >= 0)
            this.end = bodyStart + length;
        else
            this.end = Infinity;
        this.ex = {}; // Extra context stored by the main demuxer
    }

    mkvdemuxjs.MkvDemux = MkvDemux;

    return mkvdemuxjs;

})(mkvdemuxjs || {});

if (typeof module !== "undefined")
    module.exports = mkvdemuxjs;
