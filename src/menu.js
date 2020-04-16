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

// Make the overall UI, returning the post-waveform wrapper
function mkUI(small) {
    if (!small) {
        var wanted = 480;
        if (ui.video.main && ui.video.main.style.display !== "none")
            wanted += 320;
        if (window.innerHeight < wanted)
            window.resizeTo(window.innerWidth, wanted);
    }

    if (ui.postWrapper)
        return ui.postWrapper;

    // Make an outer wrapper in which to fit everything
    var outer = dce("div");
    outer.style.display = "flex";
    outer.style.flexDirection = "column";
    outer.style.minHeight = window.innerHeight + "px";

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

    // A wrapper for the main video (if visible)
    var videoMain = ui.video.main = dce("div");
    videoMain.style.flex = "auto";
    videoMain.style.display = "none";
    videoMain.style.flexDirection = "column";
    videoMain.style.minHeight = "160px";
    videoMain.style.textAlign = "center";
    outer.appendChild(videoMain);

    // And for side video
    var videoSide = ui.video.side = dce("div");
    videoSide.style.display = "none";
    videoSide.style.height = "160px";
    videoSide.style.width = "100%";
    videoSide.style.overflow = "auto hidden";
    outer.appendChild(videoSide);

    // And for our own video
    var selfVideo = ui.video.self = dce("video");
    ui.video.els.push(selfVideo);
    ui.video.hasVideo.push(false);

    // Create our watcher image
    var img = ui.waveWatcher = dce("img");
    img.style.display = "none";
    img.style.position = "absolute";
    img.style.left = "0px";
    img.style.top = "0px";
    img.style.height = "0px"; // Changed automatically when data arrives
    document.body.appendChild(img);

    // And choose its type based on support
    function usePng() {
        img.src = "images/watcher.png";
        img.style.display = "";
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
            img.style.display = "";
        }).catch(usePng);
    }

    // Make a canvas for the waveform
    ui.waveCanvas = dce("canvas");
    ui.waveCanvas.style.height = "160px";
    outer.appendChild(ui.waveCanvas);

    // And a div for the menu
    ui.menu = dce("div");
    outer.appendChild(ui.menu);

    // Make our own flexible wrapper for post-stuff
    var wrapper = dce("div");
    wrapper.style.flex = "auto";
    wrapper.style.display = "flex";
    wrapper.style.flexDirection = "column";
    ui.postWrapper = wrapper;
    outer.appendChild(wrapper);

    // Move the status box
    outer.appendChild(log);

    // Make the log display appropriate
    log.classList.add("status");

    // This is our new body
    document.body.style.margin =
        document.body.style.padding = "0";
    document.body.appendChild(outer);

    // Expand the wrapper as needed
    window.addEventListener("resize", function() {
        outer.style.minHeight = window.innerHeight + "px";
    });

    // Now actually fill in the UI

    // Set up the menu
    createMenu();

    // Set up the video UI
    updateVideoUI(0, true);

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
    if ("master" in config)
        createMasterInterface();

    return wrapper;
}

// Shrink the UI if there's nothing interesting in it
function maybeShrinkUI() {
    if (!("master" in config) &&
        ui.video.main.style.display === "none" &&
        ui.video.side.style.display === "none" &&
        ui.postWrapper.childNodes.length === 0) {
        var newH = 240 + window.outerHeight - window.innerHeight;
        if (window.innerHeight > 240)
            window.resizeTo(window.innerWidth, newH);
    }
}

// Re-adjust flex-assigned boxes
function reflexUI() {
    var hasFlex = false;
    if (ui.video.main.style.display === "none") {
        // Always flex the post wrapper if there's no video
        hasFlex = true;

    } else {
        var cns = ui.postWrapper.childNodes;
        for (var i = 0; i < cns.length; i++) {
            var cn = cns[i];
            if (cn.style.display.flex &&
                cn.style.display.flex.includes("auto")) {
                hasFlex = true;
                break;
            }
        }
    }

    // Flex or unflex
    if (hasFlex)
        ui.postWrapper.style.flex = "auto";
    else
        ui.postWrapper.style.flex = "";
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
        ui.video.main.style.display = "none";
        ui.video.side.style.display = "none";
        reflexUI();
        maybeShrinkUI();
        return;
    }

    // Displaying video
    ui.video.main.style.display = "flex";
    ui.video.side.style.display = "";

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
        el.style.maxWidth = "100%";
        el.style.height = "";
    }

    reflexUI();
    mkUI(); // Just for growth
    maybeShrinkUI();
}

// Create the menu
function createMenu() {
    var menu = ui.menu;

    function spacer() {
        var spc = dce("span");
        spc.innerText = " ";
        menu.appendChild(spc);
    }

    function btn(label, aria) {
        var btn = dce("button");
        btn.classList.add("menubutton");

        btn.innerHTML = '<i class="fas fa-' + label + '"></i>';
        btn.setAttribute("aria-label", aria);

        menu.appendChild(btn);
        spacer();
        return btn;
    }

    // Make buttons for our main actions

    // Open/close chat mode
    var chat = btn("keyboard", "Chat");
    chat.onclick = function() {
        toggleChat();
    };

    // User list, in a hidden span until we get info
    var uls = dce("span");
    uls.style.display = "none";
    menu.appendChild(uls);
    ui.userList.button = uls;
    var r = menu;
    menu = uls;
    var ul = btn("users", "User list");
    menu = r;
    ul.onclick = function() {
        toggleUserList();
    };

    // Device list
    var dl = btn("microphone-alt", "Microphone selector");
    dl.onclick = function() {
        toggleDeviceList();
    };

    // Output device list
    if (useRTC) {
        var odl = btn("headphones-alt", "Output selector");
        odl.onclick = function() {
            toggleOutputControlPanel();
        };
    }

    // Video device list
    if (useRTC) {
        var vdl = btn("video", "Camera selector");
        vdl.onclick = function() {
            toggleVideoDeviceList();
        };
    }
}


// Create the user list sub"menu"
function createUserList() {
    var wrapper = ui.userList.wrapper = dce("div");
    wrapper.classList.add("row");
    ui.userList.visible = false;

    function halfSpan() {
        var hs = dce("span");
        hs.classList.add("halfspan");
        wrapper.appendChild(hs);

        var ret = dce("div");
        ret.style.padding = "0.5em";
        hs.appendChild(ret);

        return ret;
    }

    // Make a left and right half to show the parts in
    ui.userList.left = halfSpan();
    ui.userList.right = halfSpan();

    // In case we already made elements for them, add them
    for (var i = 0; i < ui.userList.els.length; i++) {
        var el = ui.userList.els[i];
        if (el)
            userListAdd(i, el.innerText);
    }
}

// Toggle the visibility of the user list sub"menu"
function toggleUserList(to) {
    if (typeof to === "undefined")
        to = !ui.userList.visible;

    if (ui.userList.visible !== to) {
        if (to) {
            mkUI().appendChild(ui.userList.wrapper);
            ui.userList.visible = true;
        } else {
            mkUI(true).removeChild(ui.userList.wrapper);
            ui.userList.visible = false;
            maybeShrinkUI();
        }
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


// Create the device list submenu
function createDeviceList() {
    if (!userMedia) {
        // Wait until we can know what device we selected
        userMediaAvailableEvent.addEventListener("usermediaready", createDeviceList, {once: true});
        return;
    }

    // Make the main wrapper
    ui.deviceList = {};
    var wrapper = ui.deviceList.wrapper = dce("div");
    wrapper.classList.add("row");
    wrapper.classList.add("panel");
    ui.deviceList.visible = false;

    var lbl = dce("Label");
    lbl.htmlFor = "device-list";
    lbl.innerHTML = "Input device:&nbsp;";
    wrapper.appendChild(lbl);

    var sel = ui.deviceList.select = dce("select");
    sel.id = "device-list";
    wrapper.appendChild(sel);
    var selected = null;
    try {
        selected = userMedia.getTracks()[0].getSettings().deviceId;
    } catch (ex) {}

    // When it's changed, reselect the mic
    sel.onchange = function() {
        toggleDeviceList(false);
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
}

// Toggle the visibility of the device list submenu
function toggleDeviceList(to) {
    if (typeof to === "undefined")
        to = !ui.deviceList.visible;

    if (ui.deviceList.visible !== to) {
        if (to) {
            mkUI().appendChild(ui.deviceList.wrapper);
            ui.deviceList.select.focus();
            ui.deviceList.visible = true;
        } else {
            mkUI(true).removeChild(ui.deviceList.wrapper);
            ui.deviceList.visible = false;
            maybeShrinkUI();
        }
    }
}


// Create the video device list submenu
function createVideoDeviceList() {
    if (!userMedia) {
        // Wait until we can know full names
        userMediaAvailableEvent.addEventListener("usermediaready", createVideoDeviceList, {once: true});
        return;
    }

    // Make the main wrapper
    ui.videoDeviceList = {};
    var wrapper = ui.videoDeviceList.wrapper = dce("div");
    wrapper.classList.add("row");
    wrapper.classList.add("panel");
    ui.videoDeviceList.visible = false;

    var lbl = dce("Label");
    lbl.htmlFor = "video-device-list";
    lbl.innerHTML = "Camera:&nbsp;";
    wrapper.appendChild(lbl);

    var sel = ui.videoDeviceList.select = dce("select");
    sel.id = "video-device-list";
    wrapper.appendChild(sel);

    // When it's changed, start video
    sel.onchange = function() {
        toggleVideoDeviceList(false);
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

// Toggle the visibility of the video device list submenu
function toggleVideoDeviceList(to) {
    if (typeof to === "undefined")
        to = !ui.videoDeviceList.visible;

    if (ui.videoDeviceList.visible !== to) {
        if (to) {
            mkUI().appendChild(ui.videoDeviceList.wrapper);
            ui.videoDeviceList.select.focus();
            ui.videoDeviceList.visible = true;
        } else {
            mkUI(true).removeChild(ui.videoDeviceList.wrapper);
            ui.videoDeviceList.visible = false;
            maybeShrinkUI();
        }
    }
}

// Create the output device list submenu
function createOutputControlPanel() {
    if (!userMedia) {
        // Wait until we can know full names
        userMediaAvailableEvent.addEventListener("usermediaready", createOutputControlPanel, {once: true});
        return;
    }

    // Make the main wrapper
    ui.outputControlPanel = {};
    var wrapper = ui.outputControlPanel.wrapper = dce("div");
    wrapper.classList.add("panel");
    ui.outputControlPanel.visible = false;

    /*****
     * 1: Output device list
     *****/

    // The output device list has its own wrapper, so we can hide it if there are no devices
    var odl = dce("div");
    odl.classList.add("row");
    wrapper.appendChild(odl);

    // The output device list
    var lbl = dce("Label");
    lbl.htmlFor = "output-device-list";
    lbl.innerHTML = "Output:&nbsp;";
    odl.appendChild(lbl);

    var sel = ui.outputControlPanel.select = dce("select");
    sel.id = "output-device-list";
    odl.appendChild(sel);

    // When it's changed, start output
    sel.onchange = function() {
        if (sel.value === "-none") return;
        toggleOutputControlPanel(false);
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
    var volWrap = dce("div");
    volWrap.classList.add("row");
    volWrap.style.display = "flex";
    wrapper.appendChild(volWrap);

    lbl = dce("label");
    lbl.htmlFor = "output-volume";
    lbl.innerHTML = "Volume:&nbsp;";
    volWrap.appendChild(lbl);

    var vol = dce("input");
    vol.id = "output-volume";
    vol.type = "range";
    vol.min = 0;
    vol.max = 400;
    vol.value = 100;
    vol.style.flex = "auto";
    vol.style.minWidth = "5em";
    volWrap.appendChild(vol);

    var volStatus = dce("span");
    volStatus.innerHTML = "&nbsp;100%";
    volWrap.appendChild(volStatus);

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
    var compressionWrap = dce("div");
    compressionWrap.classList.add("row");
    wrapper.appendChild(compressionWrap);

    var compression = dce("input");
    compression.id = "dynamic-range-compression";
    compression.type = "checkbox";
    compression.checked = true;
    compressionWrap.appendChild(compression);

    lbl = dce("label");
    lbl.htmlFor = "dynamic-range-compression";
    lbl.innerHTML = "&nbsp;Level each speaker's volume";
    compressionWrap.appendChild(lbl);

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

// Toggle the visibility of the output device list submenu
function toggleOutputControlPanel(to) {
    if (typeof to === "undefined")
        to = !ui.outputControlPanel.visible;

    if (ui.outputControlPanel.visible !== to) {
        if (to) {
            mkUI().appendChild(ui.outputControlPanel.wrapper);
            ui.outputControlPanel.select.focus();
            ui.outputControlPanel.visible = true;
        } else {
            mkUI(true).removeChild(ui.outputControlPanel.wrapper);
            ui.outputControlPanel.visible = false;
            maybeShrinkUI();
        }
    }
}
