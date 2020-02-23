Ennuicastr is a system for recording multiple users distributed across the
world in a well-synchronized way, without significant loss, over the web.

There are a few problems that arise with distributed recording:

* Voice-over-IP solutions are the natural way to distribute voice
  communication, but all sacrifice completeness for performance. That is, all
  suffer loss in a way that should not be necessary to record. Ennuicastr uses
  existing voice-over-IP technology (namely, WebRTC) for the actual live
  communication component.

* Recording each user's audio separately usually requires that each user
  perform their own recording manually, and then send the audio to a central
  source. Aside from causing synchronization nightmares (see the next bullet
  point), this demands a fair amount of expertise from each user, and is very
  fragile: If even one user's audio doesn't work out, usually the only viable
  backup is a single recording of all users. Ennuicastr resolves this by
  packaging recording into a simple web-app, and sending the recorded audio
  live to a central server.

* Distributed users have different clocks. Even with initial synchronization,
  the clocks have different crystals, and so will drift naturally from each
  other over time. The traditional technique of having every user record
  separately, even when no one makes any mistakes, still creates headaches for
  editing, as the tracks will drift out of sync. Ennuicastr resolves both of
  these problems by having the client software synchronize its time with the
  server *continuously*, and timestamp *every* frame of audio data. Server-side
  software can then resolve the timestamped audio frames into continuous
  streams which are correclty in sync, by removing or adding silence as
  necessary.

* Most communication software does considerable processing, to make
  communication more pleasant, but for editing a recording, this preprocessing
  is at best unnecessary, and at worst counterproductive. Ennuicastr resolves
  this by... well... not doing it. Recorded audio is as raw as possible. It can
  even be recorded in lossless FLAC if you so choose.

Note that this repository includes only client-side software; the server side
is in ennuicastr-server. A small example server is provided in this repository
for testing.

Ennuicastr is licensed under the ISC license, and can be used for more-or-less
any purpose so long as you retain the copyright notices.

Ennuicastr has a number of dependencies each under their own compatible
license. See the directories vad and libav for more information on them.

No documentation is provided for running your own instances of Ennuicastr or
for its protocol.
