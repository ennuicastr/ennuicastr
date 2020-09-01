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

// Make the overall UI
function mkUI() {
    document.body.style.margin =
        document.body.style.padding = "0";
    document.body.innerHTML = ui.code;

    // When we resize, we need to flex the UI
    var wrapper = ui.wrapper = gebi("ecouter");
    wrapper.style.minHeight = window.innerHeight + "px";
    window.addEventListener("resize", function() {
        wrapper.style.minHeight = window.innerHeight + "px";
        if (!ui.resizing)
            ui.manualSize = true;
    });

    // A generic function to handle fullscreen buttons
    function fullscreen(el, btn) {
        btn.innerHTML = '<i class="fas fa-expand"></i>';

        // Toggle based on what's fullscreen
        function toggleFullscreen() {
            if (document.fullscreenElement === el)
                document.exitFullscreen();
            else
                el.requestFullscreen();
        }
        btn.onclick = toggleFullscreen;

        document.addEventListener("fullscreenchange", function() {
            if (document.fullscreenElement === el)
                btn.innerHTML = '<i class="fas fa-compress"></i>';
            else
                btn.innerHTML = '<i class="fas fa-expand"></i>';
        });

        // But hide it when the mouse isn't in the right place
        var timeout = null;
        el.style.cursor = "none";
        btn.style.display = "none";
        function mouseenter() {
            if (timeout)
                clearTimeout(timeout);
            btn.style.display = "";
            el.style.cursor = "";
            timeout = setTimeout(function() {
                btn.style.display = "none";
                el.style.cursor = "none";
                timeout = null;
            }, 5000);
        }
        el.addEventListener("mouseenter", mouseenter);
        el.addEventListener("mousemove", mouseenter);
    }

    // The video has several elements
    ui.video = {
        els: [],
        hasVideo: [],
        speech: {},
        major: -1,
        selected: -1,
        self: null,
        main: null,
        side: null
    };

    // A wrapper for *all* video
    ui.video.wrapper = gebi("ecvideo-wrapper");
    ui.video.wrapper.style.display = "none";

    // A wrapper for the main video (if visible)
    ui.video.main = gebi("ecvideo-main");
    ui.video.mainFullscreen = gebi("ecvideo-main-fs");
    fullscreen(ui.video.main, ui.video.mainFullscreen);

    // A wrapper for side video
    ui.video.side = gebi("ecvideo-side");
    ui.video.wrapperFullscreen = gebi("ecvideo-wrapper-fs");
    fullscreen(ui.video.wrapper, ui.video.wrapperFullscreen);

    // And for our own video
    var selfVideo = ui.video.self = dce("video");
    ui.video.els.push(selfVideo);
    ui.video.hasVideo.push(false);

    // The watcher image
    var img = ui.waveWatcher = gebi("ecwave-watcher");

    // And choose its type based on support
    function usePng() {
        img.src = "images/watcher.png";
    }
    if (!window.createImageBitmap || !window.fetch) {
        usePng();
    } else {
        var sample = "data:image/webp;base64,UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAfQ//73v/+BiOh/AAA=";
        fetch(sample).then(function(res) {
            return res.blob();
        }).then(function(blob) {
            return createImageBitmap(blob)
        }).then(function() {
            img.src = "images/watcher.webp";
        }).catch(usePng);
    }

    // The canvas for the waveform
    ui.waveWrapper = gebi("ecwaveform-wrapper");
    ui.waveCanvas = gebi("ecwaveform");

    // The menu
    ui.menu = {};

    // Move the status box
    var eclog = gebi("eclog");
    eclog.innerHTML = "";
    eclog.appendChild(log);

    // Load all the panels
    function panel(nm, auto) {
        var p = ui.panels[nm] = gebi("ec" + nm + "-wrapper");
        p.style.display = "none";

        if (auto)
            ui.panelAutos[nm] = gebi("ec" + auto);
    }
    panel("master", "master-invite-link-copy");
    panel("user-list");
    panel("input-device", "input-device-list");
    panel("output-device", "output-device-list");
    panel("video-device", "video-device-list");
    panel("chat", "chat-outgoing");

    // Set up the menu
    createMenu();

    // Set up the video UI
    updateVideoUI(0, true);

    // The chat box
    createChatBox();

    // The user list sub"menu"
    createUserList();

    // The device list submenu
    createDeviceList();

    // The output and video device list submenu
    if (useRTC) {
        createOutputControlPanel();
        createVideoDeviceList();
    }

    // Set up the master interface
    if ("master" in config) {
        createMasterInterface();
        ui.panels.master.style.display = "";
    }

    reflexUI();
}

// Re-adjust the flex elements of our UI and resize if needed
function reflexUI() {
    // Only two elements are meant to flex large: The video interface and chat
    if (ui.video.wrapper.style.display !== "none" || ui.panels.chat.style.display !== "none") {
        ui.waveWrapper.style.flex = "";
        ui.waveWrapper.style.minHeight = "160px";

        // Just make sure it's large enough
        if (window.innerHeight < 640) {
            ui.autoSize = 640;
            resizeUI();
        }
        return;
    }

    /* There's nothing flexing large, so make the waveform flex large and
     * calculate the correct height directly */
    ui.waveWrapper.style.flex = "auto";
    ui.waveWrapper.style.minHeight = "";
    ui.autoSize = ui.wrapper.offsetHeight - ui.waveWrapper.offsetHeight + 160;
    resizeUI();
}

// Resize the UI if the user hasn't taken control
function resizeUI() {
    if (ui.manualSize && (window.innerHeight >= 640 || window.innerHeight >= ui.autoSize))
        return;
    ui.manualSize = false;
    if (ui.resizing)
        clearTimeout(ui.resizing);
    ui.resizing = setTimeout(function() { ui.resizing = null; }, 200);
    //window.resizeTo(window.innerWidth, ui.autoSize + window.outerHeight - window.innerHeight);
    window.resizeTo(window.innerWidth, ui.autoSize);
}

// Update the video UI based on new information about this peer
function updateVideoUI(peer, neww) {
    var el = ui.video.els[peer];
    var pi, prevMajor = ui.video.major;

    if (neww) {
        function rbg() {
            return Math.round(Math.random()*0x4);
        }

        // Totally new peer, set up their videobox
        el.height = 0; // Use CSS for style
        el.style.backgroundColor = "#" + rbg() + rbg() + rbg();
        el.style.flex = "auto";
        el.style.boxSizing = "border-box";
        el.style.border = "4px solid #000";
        if (outputDeviceId)
            el.setSinkId(outputDeviceId);

        // When you click, they become the selected major
        el.onclick = function() {
            if (ui.video.selected === peer)
                ui.video.selected = -1;
            else
                ui.video.selected =
                    peer;
            updateVideoUI(peer, false);
        };
    }

    // We'll only display the video at all if *somebody* has video
    var hasVideo = false;
    for (pi = 0; pi < ui.video.hasVideo.length; pi++) {
        if (ui.video.hasVideo[pi]) {
            hasVideo = true;
            break;
        }
    }

    if (!hasVideo) {
        // Nope!
        ui.video.wrapper.style.display = "none";
        reflexUI();
        return;
    }

    // Displaying video
    ui.video.wrapper.style.display = "flex";

    // Don't let them be the major if they're gone
    if (!el) {
        // If this was the major, it won't do
        if (ui.video.major === peer)
            ui.video.major = -1;
        if (ui.video.selected === peer)
            ui.video.selected = -1;
    }

    // Perhaps there's already something selected
    if (ui.video.selected !== -1) {
        ui.video.major = ui.video.selected;

    } else if (ui.video.major === 0 ||
               !(ui.video.major in ui.video.speech)) {
        // Otherwise, choose a major based on speech
        var speech = ui.video.speech;
        var earliest = 0;
        for (pi = 1; pi < ui.video.els.length; pi++) {
            if (pi in speech && (earliest === 0 || speech[pi] < speech[earliest]))
                earliest = pi;
        }
        if (earliest !== 0)
            ui.video.major = earliest;
    }

    if (el) {
        // If we currently have no major, this'll do
        if (ui.video.major === -1 && peer !== 0)
            ui.video.major = peer;
    }

    // If we still have no major, just choose one
    if (ui.video.major === -1) {
        for (pi = ui.video.els.length - 1; pi >= 0; pi--) {
            if (ui.video.els[pi]) {
                ui.video.major = pi;
                break;
            }
        }
    }

    // First rearrange them all in the side box
    for (pi = 0; pi < ui.video.els.length; pi++) {
        el = ui.video.els[pi];
        if (!el) continue;

        var selected = (ui.video.selected === pi);
        if (pi in ui.video.speech)
            el.style.borderColor = selected?"#090":"#5e8f52";
        else
            el.style.borderColor = selected?"#999":"#000";

        if (ui.video.major === pi) continue;
        if (el.parentNode !== ui.video.side) {
            ui.video.side.appendChild(el);
            el.style.maxWidth = "214px";
            el.style.height = "100%";
        }
    }

    if (ui.video.major === prevMajor) {
        // No need to change the major
        return;
    }

    // Remove anything left over highlighted
    ui.video.main.innerHTML = "";

    // And highlight it
    if (ui.video.major !== -1) {
        el = ui.video.els[ui.video.major];
        ui.video.main.appendChild(el);
        ui.video.main.appendChild(ui.video.mainFullscreen);
        el.style.maxWidth = "100%";
        el.style.height = "";
    }

    reflexUI();
}

// Toggle the visibility of a panel
function togglePanel(panel, to) {
    var el = ui.panels[panel];
    if (typeof to === "undefined")
        to = (el.style.display === "none");

    // Don't allow multiple device panels to be visible at the same time
    if (/-device$/.test(panel)) {
        ["input", "output", "video"].forEach(function(nm) {
            ui.panels[nm + "-device"].style.display = "none";
        });
    }

    // Then switch the desired one
    el.style.display = to?"":"none";
    if (ui.panelAutos[panel])
        ui.panelAutos[panel].focus();
    reflexUI();
}

// Create the menu
function createMenu() {
    // Most buttons open or close a panel
    function toggleBtn(btn, panel) {
        btn = gebi("ecmenu-" + btn);
        btn.onclick = function() {
            togglePanel(panel);
        };
    }

    toggleBtn("master", "master");
    toggleBtn("chat", "chat");
    toggleBtn("users", "user-list");
    toggleBtn("input-devices", "input-device");
    toggleBtn("output-devices", "output-device");
    toggleBtn("camera-devices", "video-device");

    // The user list button only becomes visible if we actually have a user list, so we need to keep track of it
    ui.userList.button = gebi("ecmenu-users-hider");

    // Hide irrelevant buttons
    if (!useRTC) {
        ["output-devices", "camera-devices", "record"].forEach(function(btn) {
            gebi("ecmenu-" + btn).style.display = "none";
        });
    }

    // Mute has its own action
    var mute = ui.muteB = gebi("ecmenu-mute");
    mute.onclick = toggleMute;

    // Video recording has its own action
    var rec = gebi("ecmenu-record");
    ui.recordVideoButton = rec;
    recordVideoButton();
}

// Update the mute button
function updateMuteButton() {
    if (!userMedia) return;
    if (userMedia.getAudioTracks()[0].enabled) {
        // It's unmuted
        ui.muteB.innerHTML = '<i class="fas fa-volume-up"></i>';
        ui.muteB.setAttribute("aria-label", "Mute");

    } else {
        // It's muted
        ui.muteB.innerHTML = '<i class="fas fa-volume-mute"></i>';
        ui.muteB.setAttribute("aria-label", "Unmute");

    }
}

// Create the user list sub"menu"
function createUserList() {
    // All we care about is the left and right halves
    ui.userList.left = gebi("ecuser-list-left");
    ui.userList.right = gebi("ecuser-list-right");

    // Fill in the UI with any elements we already have
    for (var i = 0; i < ui.userList.els.length; i++) {
        var el = ui.userList.els[i];
        if (el)
            userListAdd(i, el.innerText);
    }
}

// Add a user to the user list
function userListAdd(idx, name) {
    // Create the node
    var els = ui.userList.els;
    while (els.length <= idx)
        els.push(null);
    var el = els[idx];
    if (!el) {
        el = els[idx] = dce("div");
        el.style.backgroundColor = "#000";
    }
    el.innerText = name;
    el.setAttribute("aria-label", name + ": Not speaking");

    if (!ui.userList.left) return;
    ui.userList.button.style.display = "";

    // Add it to one side or the other to balance
    var addTo;
    if (ui.userList.left.childNodes.length <=
        ui.userList.right.childNodes.length)
        addTo = ui.userList.left;
    else
        addTo = ui.userList.right;
    addTo.appendChild(el);
}

// Remove a user from the user list
function userListRemove(idx) {
    var el = ui.userList.els[idx];
    if (!el) return;
    els[idx] = null;

    el.parentNode.removeChild(el);
}

// Update the speaking status of an element in the user list
function userListUpdate(idx, speaking) {
    var el = ui.userList.els[idx];
    if (!el) return;

    el.style.backgroundColor = speaking?"#050":"#000";
    el.setAttribute("aria-label", el.innerText + ": " + (speaking?"Speaking":"Not speaking"));
}

// Create the (input) device list submenu
function createDeviceList() {
    if (!userMedia) {
        // Wait until we can know what device we selected
        userMediaAvailableEvent.addEventListener("usermediaready", createDeviceList, {once: true});
        return;
    }

    ui.deviceList = {
        select: gebi("ecinput-device-list"),
        noiserWrapper: gebi("ecnoise-reduction-wrapper"),
        noiser: gebi("ecnoise-reduction")
    };

    var sel = ui.deviceList.select;
    var selected = null;
    try {
        selected = userMedia.getTracks()[0].getSettings().deviceId;
    } catch (ex) {}

    // When it's changed, reselect the mic
    sel.onchange = function() {
        togglePanel("input-device", false);
        getMic(sel.value);
    };

    // Fill it with the available devices
    navigator.mediaDevices.enumerateDevices().then(function(devices) {
        var ctr = 1;
        devices.forEach(function(dev) {
            if (dev.kind !== "audioinput") return;

            // Create an option for this
            var opt = dce("option");
            var label = dev.label || ("Mic " + ctr++);
            opt.innerText = label;
            opt.value = dev.deviceId;
            if (dev.deviceId === selected)
                opt.selected = true;
            sel.appendChild(opt);
        });

    }).catch(function() {}); // Nothing really to do here

    // And the selector for noise reduction
    var noiser = ui.deviceList.noiser;
    noiser.checked = useNR;
    noiser.onchange = function() {
        userNR = noiser.checked;
    };

    if (!useRTC)
        ui.deviceList.noiserWrapper.style.display = "none";
}

// Create the video device list submenu
function createVideoDeviceList() {
    if (!userMedia) {
        // Wait until we can know full names
        userMediaAvailableEvent.addEventListener("usermediaready", createVideoDeviceList, {once: true});
        return;
    }

    ui.videoDeviceList = {
        select: gebi("ecvideo-device-list")
    };

    var sel = ui.videoDeviceList.select;

    // When it's changed, start video
    sel.onchange = function() {
        togglePanel("video-device", false);
        getCamera(sel.value);
    };

    // Add a pseudo-device so nothing is selected at first
    var opt = dce("option");
    opt.innerText = "None";
    opt.value = "-none";
    sel.appendChild(opt);

    // Fill it with the available devices
    navigator.mediaDevices.enumerateDevices().then(function(devices) {
        var ctr = 1;
        devices.forEach(function(dev) {
            if (dev.kind !== "videoinput") return;

            // Create an option for this
            var opt = dce("option");
            var label = dev.label || ("Camera " + ctr++);
            opt.innerText = label;
            opt.value = dev.deviceId;
            sel.appendChild(opt);
        });

        // Add a special pseudo-device for screen capture
        var opt = dce("option");
        opt.innerText = "Capture screen";
        opt.value = "-screen";
        sel.appendChild(opt);

    }).catch(function() {}); // Nothing really to do here
}

// Create the output device list submenu
function createOutputControlPanel() {
    if (!userMedia) {
        // Wait until we can know full names
        userMediaAvailableEvent.addEventListener("usermediaready", createOutputControlPanel, {once: true});
        return;
    }

    ui.outputControlPanel = {
        selectWrapper: gebi("ecoutput-device-list-wrapper"),
        select: gebi("ecoutput-device-list"),
        volume: gebi("ecoutput-volume"),
        volumeStatus: gebi("ecoutput-volume-status"),
        compression: gebi("ecdynamic-range-compression")
    };

    /*****
     * 1: Output device list
     *****/

    var sel = ui.outputControlPanel.select;

    // When it's changed, start output
    sel.onchange = function() {
        if (sel.value === "-none") return;
        togglePanel("output-device", false);
        setOutputDevice(sel.value);
    };

    // Add a pseudo-device so nothing is selected at first
    var opt = dce("option");
    opt.innerText = "-";
    opt.value = "-none";
    sel.appendChild(opt);

    // Fill it with the available devices
    navigator.mediaDevices.enumerateDevices().then(function(devices) {
        var ctr = 1, hadOutputs = false;
        devices.forEach(function(dev) {
            if (dev.kind !== "audiooutput") return;
            hadOutputs = true;

            // Create an option for this
            var opt = dce("option");
            var label = dev.label || ("Output " + ctr++);
            opt.innerText = label;
            opt.value = dev.deviceId;
            sel.appendChild(opt);
        });

        if (!hadOutputs) {
            // This selector does nothing for us
            odl.style.display = "none";
        }

    }).catch(function() {}); // Nothing really to do here

    /*****
     * 2: Master volume
     *****/
    var vol = ui.outputControlPanel.volume;
    var volStatus = ui.outputControlPanel.volumeStatus;

    // When we change the volume, pass that to the compressors
    vol.oninput = function() {
        // Snap to 100%
        if (vol.value >= 90 && vol.value <= 110)
            vol.value = 100;

        // Show the status
        volStatus.innerHTML = "&nbsp;" + vol.value + "%";

        // Set it
        rtcCompression.gain.volume = vol.value / 100;
        compressorChanged();
    };

    /*****
     * 3: Dynamic range compression (volume leveling)
     *****/
    var compression = ui.outputControlPanel.compression;
    compression.checked = true;

    // Swap on or off compression
    compression.onchange = function() {
        var c = rtcCompression;
        if (compression.checked) {
            // FIXME: Magic numbers
            c.compressor.ratio = 8;
            c.gain.gain = null;
        } else {
            c.compressor.ratio = 1;
            c.gain.gain = 1;
        }
        compressorChanged();
    };
}
