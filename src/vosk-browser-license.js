/*
 * This software is compiled from several sources, the licenses for which are
 * included herein.
 *
 * ---
 *
 * Vosk-Browser
 * Copyright 2020, 2021 Ciaran O'Reilly
 *
 * The Initial Developer of the the WASM bindings
 * (https://github.com/dtreskunov/tiny-kaldi) for the VOSK API is Denis
 * Treskunov (https://github.com/dtreskunov).
 * Copyright 2020, Denis Treskunov
 *
 * The Developer of the VOSK API (https://github.com/alphacep/vosk-api) is
 * Alpha Cephei Inc (https://alphacephei.com/en/).
 * Copyright 2019-2021 Alpha Cephei Inc. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not
 * use this file except in compliance with the License. You may obtain a copy
 * of the License at
 *
 *  http://www.apache.org/licenses/LICENSE-2.0
 *
 * THIS CODE IS PROVIDED *AS IS* BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, EITHER EXPRESS OR IMPLIED, INCLUDING WITHOUT LIMITATION ANY IMPLIED
 * WARRANTIES OR CONDITIONS OF TITLE, FITNESS FOR A PARTICULAR PURPOSE,
 * MERCHANTABLITY OR NON-INFRINGEMENT.
 * See the Apache 2 License for the specific language governing permissions and
 * limitations under the License.
 *
 * ---
 *
 * kaldi:
 *
 * Each of the files comprising Kaldi v1.0 have been separately licensed by
 * their respective author(s) under the terms of the Apache License v 2.0 (set
 * forth below).  The source code headers for each file specifies the individual
 * authors and source material for that file as well the corresponding copyright
 * notice.  For reference purposes only: A cumulative list of all individual
 * contributors and original source material as well as the full text of the Apache
 * License v 2.0 are set forth below.
 *
 * Individual Contributors (in alphabetical order)
 *
 *       Mohit Agarwal
 *       Tanel Alumae
 *       Gilles Boulianne
 *       Lukas Burget
 *       Dogan Can
 *       Guoguo Chen
 *       Gaofeng Cheng
 *       Cisco Corporation
 *       Pavel Denisov
 *       Ilya Edrenkin
 *       Ewald Enzinger
 *       Joachim Fainberg
 *       Daniel Galvez
 *       Pegah Ghahremani
 *       Arnab Ghoshal
 *       Ondrej Glembek
 *       Go Vivace Inc.
 *       Allen Guo
 *       Hossein Hadian
 *       Lv Hang
 *       Mirko Hannemann
 *       Hendy Irawan
 *       Navdeep Jaitly
 *       Johns Hopkins University
 *       Shiyin Kang
 *       Kirill Katsnelson
 *       Tom Ko
 *       Danijel Korzinek
 *       Gaurav Kumar
 *       Ke Li
 *       Matthew Maciejewski
 *       Vimal Manohar
 *       Yajie Miao
 *       Microsoft Corporation
 *       Petr Motlicek
 *       Xingyu Na
 *       Vincent Nguyen
 *       Lucas Ondel
 *       Vassil Panayotov
 *       Vijayaditya Peddinti
 *       Phonexia s.r.o.
 *       Ondrej Platek
 *       Daniel Povey
 *       Yanmin Qian
 *       Ariya Rastrow
 *       Saarland University
 *       Omid Sadjadi
 *       Petr Schwarz
 *       Yiwen Shao
 *       Nickolay V. Shmyrev
 *       Jan Silovsky
 *       Eduardo Silva
 *       Peter Smit
 *       David Snyder
 *       Alexander Solovets
 *       Georg Stemmer
 *       Pawel Swietojanski
 *       Jan "Yenda" Trmal
 *       Albert Vernon
 *       Karel Vesely
 *       Yiming Wang
 *       Shinji Watanabe
 *       Minhua Wu
 *       Haihua Xu
 *       Hainan Xu
 *       Xiaohui Zhang
 *
 * Other Source Material
 *
 *     This project includes a port and modification of materials from JAMA: A Java
 *   Matrix Package under the following notice: "This software is a cooperative
 *   product of The MathWorks and the National Institute of Standards and Technology
 *   (NIST) which has been released to the public domain." This notice and the
 *   original code is available at http://math.nist.gov/javanumerics/jama/
 *
 *    This project includes a modified version of code published in Malvar, H.,
 *   "Signal processing with lapped transforms," Artech House, Inc., 1992.  The
 *   current copyright holder, Henrique S. Malvar, has given his permission for the
 *   release of this modified version under the Apache License 2.0.
 *
 *   This project includes material from the OpenFST Library v1.2.7 available at
 *   http://www.openfst.org and released under the Apache License v. 2.0.
 *
 *   [OpenFst COPYING file begins here]
 *
 *     Licensed under the Apache License, Version 2.0 (the "License");
 *     you may not use these files except in compliance with the License.
 *     You may obtain a copy of the License at
 *
 *        http://www.apache.org/licenses/LICENSE-2.0
 *
 *     Unless required by applicable law or agreed to in writing, software
 *     distributed under the License is distributed on an "AS IS" BASIS,
 *     WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *     See the License for the specific language governing permissions and
 *     limitations under the License.
 *
 *     Copyright 2005-2010 Google, Inc.
 *
 *   [OpenFst COPYING file ends here]
 *
 * ---
 *
 * CLAPACK:
 *
 * Copyright (c) 1992-2008 The University of Tennessee.  All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 * - Redistributions of source code must retain the above copyright
 *   notice, this list of conditions and the following disclaimer. 
 *
 * - Redistributions in binary form must reproduce the above copyright
 *   notice, this list of conditions and the following disclaimer listed
 *   in this license in the documentation and/or other materials
 *   provided with the distribution.
 *
 * - Neither the name of the copyright holders nor the names of its
 *   contributors may be used to endorse or promote products derived from
 *   this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT  
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT 
 * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT  
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE. 
 *
 * ---
 *
 * GSL:
 *
 * Copyright (C) 1996-2019 Brian Gough et al.
 * 
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 3 of the License, or (at
 * your option) any later version.
 * 
 * This program is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 * General Public License for more details.
 * 
 * You should have received a copy of the GNU General Public License
 * along with this program; if not, write to the Free Software
 * Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA 02110-1301, USA.
 *
 * ---
 *
 * zlib:
 *
 * Copyright (C) 1995-2017 Jean-loup Gailly and Mark Adler
 *
 * This software is provided 'as-is', without any express or implied
 * warranty.  In no event will the authors be held liable for any damages
 * arising from the use of this software.
 *
 * Permission is granted to anyone to use this software for any purpose,
 * including commercial applications, and to alter it and redistribute it
 * freely, subject to the following restrictions:
 *
 * 1. The origin of this software must not be misrepresented; you must not
 *    claim that you wrote the original software. If you use this software
 *    in a product, an acknowledgment in the product documentation would be
 *    appreciated but is not required.
 * 2. Altered source versions must be plainly marked as such, and must not be
 *    misrepresented as being the original software.
 * 3. This notice may not be removed or altered from any source distribution.
 *
 * ---
 *
 * libarchive:
 *
 * Copyright (c) 2003-2020 Tim Kientzle et al.
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 * 1. Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer
 *    in this position and unchanged.
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY THE AUTHOR(S) ``AS IS'' AND ANY EXPRESS OR
 * IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES
 * OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED.
 * IN NO EVENT SHALL THE AUTHOR(S) BE LIABLE FOR ANY DIRECT, INDIRECT,
 * INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT
 * NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
 * THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 *
 * ---
 *
 * emscripten and musl:
 *
 * Copyright (c) 2010-2014 Emscripten authors, see AUTHORS file.
 * Copyright © 2005-2014 Rich Felker, et al.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to
 * deal in the Software without restriction, including without limitation the
 * rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
 * sell copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
 * IN THE SOFTWARE.
 *
 * ---
 *
 * Note also the license appearing below, which covers an included polyfill.
 */
