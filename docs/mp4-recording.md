# Recording live using MP4

MP4 is not a suitable container format for live recording: its “MOOV atom”
contains both the codec parameters (necessary to decode at all) and the index
(only necessary to seek), but the index cannot be created until the end of the
file, so the entire MOOV atom cannot be created until the end of the file. This
means that if you record using the MP4 container, the risk of data loss is
*extreme*, as any interruption will result in the loss of all data up to the
point of interruption.

Unfortunately, Safari's `MediaRecorder` API only supports recording to MP4.
Getting this to work in a safe way required a strange trick, and that trick is
documented here.

The MOOV atom contains the codec parameters and the index. We don't need the
index at all. The basic observation is that if you record the same source twice,
there's no reason for Safari to use different codec parameters (note: things
like bitrate aren't important here, just more basic things like pixel format and
image size), so we “recapture”: record a brief file, use it just to extract
codec parameters, then start a *new* capture, forcing the codec parameters from
the first capture onto that.

(The remainder of this description uses line numbers from a particular version
of `video-record.ts`. See
https://github.com/ennuicastr/ennuicastr/blob/4b4d237d5ebb59be8b8be03d90e20026481a400e/src/video-record.ts#L297
)

First, we create a `MediaRecorder` stream using the same source as we intend to
record. We record that for the minimum amount of time (see line 317 in the above
link; we stop as soon as we've captured any data), finish reading the data
(322–331), and we then have a complete MP4 file.

That file is written into memory in libav.js (335). Note that as we recorded the
minimum amount of data, just one or two frames, this file will not be
significantly large, so doing this in memory isn't a problem. We then initialize
the demuxer using `ff_init_demuxer_file` (337), which also calls
`avformat_find_stream_info`. `avformat_find_stream_info` finds the codec
parameters in a complete file, but gets garbage codec parameters in an
incomplete file or stream.

Note that in `video-record.ts` we only care about one stream, and so only get a
single `in_stream`, being stream 0. This easily generalizes to any number of
streams.

Each stream from `ff_init_demuxer_file` has a `codecpar` element (338), which is
the codec parameters from that stream. Note that the demuxer is *not* closed
until the output is complete¹, as this `codecpar` pointer actually belongs to
the demuxer. We use those codec parameters when initializing the muxer
(346). Note that it is not necessary to use those codec parameters in the “real”
demuxer (478), as we don't intend to actually decode the data live. If we wanted
to decode the data, it would further be necessary to use those codec parameters
when initializing the decoder (*not* the demuxer, which is quite happy to
receive packets whether it understands them or not).

Of course, if the muxer is also using MP4, it will be equally useless.
Ennuicastr uses Matroska as the muxer, but in actual fact, most formats *are*
streamable, and MP4 is a notable exception from that rule. The closest format to
MP4 that is streamable is the so-called “ismv” format, which is a Microsoft hack
of the MP4 format that consists essentially of many MP4 fragments concatenated
together. While it's not technically correct MP4, I'm yet to encounter a program
that can't decode it correctly, so it would probably be safe to use it.

¹ Actually, `video-record.ts` doesn't close it at all, since it just destroys
the entire libav.js instance when it's done.


## Details

The FFmpeg documentation on the `ismv` format contains an excellent explanation
for the problems with MP4, reproduced here:

    The mov/mp4/ismv muxer supports fragmentation. Normally, a MOV/MP4 file has
    all the metadata about all packets stored in one location (written at the
    end of the file, it can be moved to the start for better playback by adding
    faststart to the movflags, or using the qt-faststart tool). A fragmented
    file consists of a number of fragments, where packets and metadata about
    these packets are stored together. Writing a fragmented file has the
    advantage that the file is decodable even if the writing is interrupted
    (while a normal MOV/MP4 is undecodable if it is not properly finished), and
    it requires less memory when writing very long files (since writing normal
    MOV/MP4 files stores info about every single packet in memory until the file
    is closed). The downside is that it is less compatible with other
    applications.
