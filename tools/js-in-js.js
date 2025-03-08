#!/usr/bin/env node
/*
 * Copyright (c) 2018-2025 Yahweasel
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
 * This embeds JavaScript into JavaScript as a JavaScript string.
 */

const fs = require("fs/promises");

async function main() {
    const inp = await fs.readFile(process.argv[2], "utf8");
    const outp = `/* THIS FILE IS GENERATED AUTOMATICALLY. DO NOT EDIT. */\n` +
        `export const js = ` +
        JSON.stringify("data:application/javascript," +
            encodeURIComponent(inp)) +
        `;\n`;
    process.stdout.write(outp);
}
main();
