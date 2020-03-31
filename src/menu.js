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
        if (window.innerHeight < 480)
            window.resizeTo(window.innerWidth, 480);
    }

    if (ui.postWrapper)
        return ui.postWrapper;

    // Make an outer wrapper in which to fit everything
    var outer = dce("div");
    outer.style.display = "flex";
    outer.style.flexDirection = "column";
    outer.style.minHeight = window.innerHeight + "px";

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

    // The device list submenu
    createDeviceList();

    // Set up the master interface
    if ("master" in config)
        createMasterInterface();

    return wrapper;
}

// Shrink the UI if there's nothing interesting in it
function maybeShrinkUI() {
    if (ui.postWrapper.childNodes.length === 0) {
        var newH = 240 + window.outerHeight - window.innerHeight;
        if (window.innerHeight > 240)
            window.resizeTo(window.innerWidth, newH);
    }
}

// Create the menu
function createMenu() {
    var menu = ui.menu;

    function spacer() {
        var spc = dce("span");
        spc.innerText = " ";
        menu.appendChild(spc);
    }

    function btn() {
        var btn = dce("button");
        btn.classList.add("menubutton");
        menu.appendChild(btn);
        spacer();
        return btn;
    }

    // Make buttons for our main actions

    // Open/close chat mode
    var chat = btn();
    chat.innerHTML = '<i class="fas fa-keyboard"></i>';
    chat.onclick = function() {
        toggleChat();
    };

    // Device list
    var dl = btn();
    dl.innerHTML = '<i class="fas fa-microphone-alt"></i>';
    dl.onclick = function() {
        toggleDeviceList();
    };
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
    ui.deviceList.visible = false;

    var lbl = dce("Label");
    lbl.htmlFor = "device-list";
    lbl.innerText = "Input device: ";
    wrapper.appendChild(lbl);

    var sel = dce("select");
    sel.id = "device-list";
    wrapper.appendChild(sel);
    var selected = null;
    try {
        selected = userMedia.getTracks()[0].getSettings().deviceId;
    } catch (ex) {}

    // When it's changed, reselct the mic
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
            ui.deviceList.visible = true;
        } else {
            mkUI(true).removeChild(ui.deviceList.wrapper);
            ui.deviceList.visible = false;
            maybeShrinkUI();
        }
    }
}
