/*
 * Copyright (c) 2022, 2023 Yahweasel
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

/*
 * This file is part of Ennuicastr.
 *
 * Loader with progress indication.
 */

interface Library {
    name: string;
    file: string;
}

/**
 * Generic library loader. Loads the named JavaScript library and any given
 * extra libraries, showing loading progress if it takes more than a half a
 * second.
 */
async function ecLoadLibrary(
    lib: Library, opts: {
        extras?: Library[],
        noLoad?: boolean
    } = {}
): Promise<unknown> {
    const toLoad = [lib].concat(opts.extras || []);

    // First fetch it normally, so that it caches
    try {
        for (const lib of toLoad) {
            const f = await fetch(lib.file);

            // Get the reader to manage progress
            const reader = f.body.getReader();
            const total = +f.headers.get("content-length") || 0;
            let loaded = 0;
            let rdDone: (value:unknown)=>unknown = null;
            const rdDoneP = new Promise(res => rdDone = res);

            (async function() {
                while (true) {
                    const rd = await reader.read();
                    if (rd.done) {
                        loaded = total;
                        rdDone(null);
                        break;
                    }
                    loaded += rd.value.length;
                }
            })();

            // Display progress with an interval
            let box: HTMLElement = null,
                loadedDisp: HTMLElement = null;

            const i = setInterval(() => {
                if (!box) {
                    box = document.createElement("div");
                    Object.assign(box.style, {
                        position: "fixed",
                        left: "0px",
                        top: "0px",
                        right: "0px",
                        bottom: "0px",
                        zIndex: "1000",
                        background: "#000",
                        color: "#aaa"
                    });
                    document.body.appendChild(box);

                    loadedDisp = document.createElement("div");
                    Object.assign(loadedDisp.style, {
                        position: "absolute",
                        left: "0px",
                        width: "0%",
                        top: "calc(50% - 1.125em)",
                        height: "2.25em",
                        background: "#030"
                    });
                    box.appendChild(loadedDisp);

                    const info = document.createElement("div");
                    Object.assign(info.style, {
                        position: "absolute",
                        left: "0px",
                        width: "100%",
                        top: "calc(50% - 0.75em)",
                        textAlign: "center"
                    });
                    info.innerText = `Loading ${lib.name}...`;
                    box.appendChild(info);
                }

                loadedDisp.style.width = total ?
                    ((loaded / total * 100) + "%") :
                    "0%";
            }, 500);

            // Wait for it to finish
            await rdDoneP;
            clearInterval(i);
            if (box)
                document.body.removeChild(box);
        }
    } catch (ex) {}

    if (opts.noLoad) {
        // Don't actually load it
        return;
    }

    // Now it should be in the cache, so load it normally
    return new Promise((res, rej) => {
        const scr = document.createElement("script");
        scr.addEventListener("load", res);
        scr.addEventListener("error", rej);
        scr.src = lib.file;
        scr.async = true;
        document.body.appendChild(scr);
    });
}
