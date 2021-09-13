import zlib from 'zlib'
import iconvlite from 'iconv-lite'

class KaitaiStream {
  private _byteOffset: number
  private _buffer: ArrayBuffer = new ArrayBuffer(1)
  private _dataView: DataView = new DataView(this._buffer)
  private _byteLength: number = 0
  public pos: number
  public bitsLeft: number = 0
  public bits: number = 0

  constructor(arrayBuffer: ArrayBuffer, byteOffset?: number) {
    this._byteOffset = byteOffset || 0
    if (arrayBuffer instanceof ArrayBuffer) {
      this.buffer = arrayBuffer
    } else if (typeof arrayBuffer == 'object') {
      this.dataView = arrayBuffer
      if (byteOffset) {
        this._byteOffset += byteOffset
      }
    } else {
      this.buffer = new ArrayBuffer(arrayBuffer || 1)
    }
    this.pos = 0
    this.alignToByte()
  }

  static zlib = zlib
  static iconvlite = iconvlite
  static endianness = new Int8Array(new Int16Array([1]).buffer)[0] > 0

  static bytesStripRight(data: string | any[], padByte: any) {
    let newLen = data.length
    while (data[newLen - 1] === padByte) newLen--
    return data.slice(0, newLen)
  }

  static bytesTerminate(data: string | any[], term: any, include: any) {
    let newLen = 0
    let maxLen = data.length
    while (newLen < maxLen && data[newLen] !== term) newLen++
    if (include && newLen < maxLen) newLen++
    return data.slice(0, newLen)
  }

  static bytesToStr(
    // FIXME
    arr:
      | ArrayBuffer
      | { valueOf(): ArrayBuffer | SharedArrayBuffer }
      | ArrayBufferView
      | undefined
      | any,
    encoding: BufferEncoding | null | undefined
  ) {
    if (encoding == null || encoding.toLowerCase() === 'ascii') {
      return KaitaiStream.createStringFromArray(arr)
    } else {
      if (typeof TextDecoder === 'function') {
        // we're in the browser that supports TextDecoder
        return new TextDecoder(encoding).decode(arr)
      } else {
        // probably we're in node.js

        // check if it's supported natively by node.js Buffer
        // see https://github.com/nodejs/node/blob/master/lib/buffer.js#L187 for details
        switch (encoding.toLowerCase()) {
          case 'utf8':
          case 'utf-8':
          case 'ucs2':
          case 'ucs-2':
          case 'utf16le':
          case 'utf-16le':
            return Buffer.from(arr).toString(encoding)
            break
          default:
            return KaitaiStream.iconvlite.decode(arr, encoding)
        }
      }
    }
  }

  static processXorOne(data: number[], key: number) {
    let r = new Uint8Array(data.length)
    let dl = data.length
    for (let i = 0; i < dl; i++) r[i] = data[i] ^ key
    return r
  }

  static processXorMany(data: string | any[], key: string | any[]) {
    let dl = data.length
    let r = new Uint8Array(dl)
    let kl = key.length
    let ki = 0
    for (let i = 0; i < dl; i++) {
      r[i] = data[i] ^ key[ki]
      ki++
      if (ki >= kl) ki = 0
    }
    return r
  }

  static processRotateLeft(
    data: string | any[],
    amount: number,
    groupSize: string | number
  ) {
    if (groupSize !== 1)
      throw 'unable to rotate group of ' + groupSize + ' bytes yet'

    let mask = groupSize * 8 - 1
    let antiAmount = -amount & mask

    let r = new Uint8Array(data.length)
    for (let i = 0; i < data.length; i++)
      r[i] = ((data[i] << amount) & 0xff) | (data[i] >> antiAmount)

    return r
  }

  static processZlib(buf: {
    buffer: {
      slice: (
        arg0: any,
        arg1: any
      ) => WithImplicitCoercion<ArrayBuffer | SharedArrayBuffer>
    }
    byteOffset: any
    byteLength: any
  }) {
    let r = KaitaiStream.zlib.inflateSync(
      Buffer.from(
        buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
      )
    )
    return r
  }

  static mod(a: number, b: number) {
    if (b <= 0) throw 'mod divisor <= 0'
    let r = a % b
    if (r < 0) r += b
    return r
  }

  static arrayMin(arr: string | any[]) {
    let min = arr[0]
    let x
    for (let i = 1, n = arr.length; i < n; ++i) {
      x = arr[i]
      if (x < min) min = x
    }
    return min
  }

  static arrayMax(arr: string | any[]) {
    let max = arr[0]
    let x
    for (let i = 1, n = arr.length; i < n; ++i) {
      x = arr[i]
      if (x > max) max = x
    }
    return max
  }

  static byteArrayCompare(a: string | any[], b: string | any[]) {
    if (a === b) return 0
    let al = a.length
    let bl = b.length
    let minLen = al < bl ? al : bl
    for (let i = 0; i < minLen; i++) {
      let cmp = a[i] - b[i]
      if (cmp !== 0) return cmp
    }

    // Reached the end of at least one of the arrays
    if (al === bl) {
      return 0
    } else {
      return al - bl
    }
  }

  static createStringFromArray(array: {
    subarray: (arg0: number, arg1: number) => number[]
    length: number
    slice: (arg0: number, arg1: number) => number[]
  }) {
    let chunk_size = 0x8000
    let chunks = []
    let useSubarray = typeof array.subarray === 'function'
    for (let i = 0; i < array.length; i += chunk_size) {
      chunks.push(
        String.fromCharCode.apply(
          null,
          useSubarray
            ? array.subarray(i, i + chunk_size)
            : array.slice(i, i + chunk_size)
        )
      )
    }
    return chunks.join('')
  }

  public get buffer() {
    this._trimAlloc()
    return this._buffer
  }
  public set buffer(v) {
    this._buffer = v
    this._dataView = new DataView(this._buffer, this._byteOffset)
    this._byteLength = this._buffer.byteLength
  }

  public get byteOffset() {
    return this._byteOffset
  }
  public set byteOffset(v) {
    this._byteOffset = v
    this._dataView = new DataView(this._buffer, this._byteOffset)
    this._byteLength = this._buffer.byteLength
  }

  public get dataView() {
    return this._dataView
  }
  public set dataView(v) {
    this._byteOffset = v.byteOffset
    this._buffer = v.buffer
    this._dataView = new DataView(this._buffer, this._byteOffset)
    this._byteLength = this._byteOffset + v.byteLength
  }

  public get size() {
    return this._byteLength - this._byteOffset
  }

  public isEof() {
    return this.pos >= this.size && this.bitsLeft === 0
  }

  public seek(pos: number) {
    let npos = Math.max(0, Math.min(this.size, pos))
    this.pos = isNaN(npos) || !isFinite(npos) ? 0 : npos
  }

  private _trimAlloc() {
    if (this._byteLength === this._buffer.byteLength) {
      return
    }
    let buf = new ArrayBuffer(this._byteLength)
    let dst = new Uint8Array(buf)
    let src = new Uint8Array(this._buffer, 0, dst.length)
    dst.set(src)
    this.buffer = buf
  }

  public readS1() {
    this.ensureBytesLeft(1)
    let v = this._dataView.getInt8(this.pos)
    this.pos += 1
    return v
  }

  public readS2be() {
    this.ensureBytesLeft(2)
    let v = this._dataView.getInt16(this.pos)
    this.pos += 2
    return v
  }
  public readS4be() {
    this.ensureBytesLeft(4)
    let v = this._dataView.getInt32(this.pos)
    this.pos += 4
    return v
  }
  public readS8be() {
    this.ensureBytesLeft(8)
    let v = this._dataView.getBigInt64(this.pos)
    this.pos += 8
    return v
  }

  public readS2le() {
    this.ensureBytesLeft(2)
    let v = this._dataView.getInt16(this.pos, true)
    this.pos += 2
    return v
  }
  public readS4le() {
    this.ensureBytesLeft(4)
    let v = this._dataView.getInt32(this.pos, true)
    this.pos += 4
    return v
  }
  public readS8le() {
    this.ensureBytesLeft(8)
    let v = this._dataView.getBigInt64(this.pos, true)
    this.pos += 8
    return v
  }

  public readU1() {
    this.ensureBytesLeft(1)
    let v = this._dataView.getUint8(this.pos)
    this.pos += 1
    return v
  }

  public readU2be() {
    this.ensureBytesLeft(2)
    let v = this._dataView.getUint16(this.pos)
    this.pos += 2
    return v
  }
  public readU4be() {
    this.ensureBytesLeft(4)
    let v = this._dataView.getUint32(this.pos)
    this.pos += 4
    return v
  }
  public readU8be() {
    this.ensureBytesLeft(8)
    let v = this._dataView.getBigUint64(this.pos)
    this.pos += 8
    return v
  }

  public readU2le() {
    this.ensureBytesLeft(2)
    let v = this._dataView.getUint16(this.pos, true)
    this.pos += 2
    return v
  }
  public readU4le() {
    this.ensureBytesLeft(4)
    let v = this._dataView.getUint32(this.pos, true)
    this.pos += 4
    return v
  }
  public readU8le() {
    this.ensureBytesLeft(8)
    let v = this._dataView.getBigUint64(this.pos, true)
    this.pos += 8
    return v
  }

  public readF4be() {
    this.ensureBytesLeft(4)
    let v = this._dataView.getFloat32(this.pos)
    this.pos += 4
    return v
  }
  public readF8be() {
    this.ensureBytesLeft(8)
    let v = this._dataView.getFloat64(this.pos)
    this.pos += 8
    return v
  }

  public readF4le() {
    this.ensureBytesLeft(4)
    let v = this._dataView.getFloat32(this.pos, true)
    this.pos += 4
    return v
  }
  public readF8le() {
    this.ensureBytesLeft(8)
    let v = this._dataView.getFloat64(this.pos, true)
    this.pos += 8
    return v
  }

  public alignToByte() {
    this.bits = 0
    this.bitsLeft = 0
  }

  public readBitsIntBe(n: number) {
    // JS only supports bit operations on 32 bits
    if (n > 32) {
      throw new Error(
        `readBitsIntBe: the maximum supported bit length is 32 (tried to read ${n} bits)`
      )
    }
    let bitsNeeded = n - this.bitsLeft
    if (bitsNeeded > 0) {
      // 1 bit  => 1 byte
      // 8 bits => 1 byte
      // 9 bits => 2 bytes
      let bytesNeeded = Math.ceil(bitsNeeded / 8)
      let buf = this.readBytes(bytesNeeded)
      for (let i = 0; i < bytesNeeded; i++) {
        this.bits <<= 8
        this.bits |= buf[i]
        this.bitsLeft += 8
      }
    }

    // raw mask with required number of 1s, starting from lowest bit
    let mask = n === 32 ? 0xffffffff : (1 << n) - 1
    // shift this.bits to align the highest bits with the mask & derive reading result
    let shiftBits = this.bitsLeft - n
    let res = (this.bits >>> shiftBits) & mask
    // clear top bits that we've just read => AND with 1s
    this.bitsLeft -= n
    mask = (1 << this.bitsLeft) - 1
    this.bits &= mask

    return res
  }

  public readBitsInt = this.readBitsIntBe

  public readBitsIntLe(n: number) {
    // JS only supports bit operations on 32 bits
    if (n > 32) {
      throw new Error(
        `readBitsIntLe: the maximum supported bit length is 32 (tried to read ${n} bits)`
      )
    }
    let bitsNeeded = n - this.bitsLeft
    if (bitsNeeded > 0) {
      // 1 bit  => 1 byte
      // 8 bits => 1 byte
      // 9 bits => 2 bytes
      let bytesNeeded = Math.ceil(bitsNeeded / 8)
      let buf = this.readBytes(bytesNeeded)
      for (let i = 0; i < bytesNeeded; i++) {
        this.bits |= buf[i] << this.bitsLeft
        this.bitsLeft += 8
      }
    }

    // raw mask with required number of 1s, starting from lowest bit
    let mask = n === 32 ? 0xffffffff : (1 << n) - 1
    // derive reading result
    let res = this.bits & mask
    // remove bottom bits that we've just read by shifting
    this.bits >>>= n
    this.bitsLeft -= n

    return res
  }

  public readBytes(len: number) {
    return this.mapUint8Array(len)
  }

  public readBytesFull() {
    return this.mapUint8Array(this.size - this.pos)
  }

  public readBytesTerm(
    terminator: string | number,
    include: any,
    consume: any,
    eosError: any
  ) {
    let blen = this.size - this.pos
    let u8 = new Uint8Array(this._buffer, this._byteOffset + this.pos)
    for (var i = 0; i < blen && u8[i] !== terminator; i++); // find first zero byte
    if (i === blen) {
      // we've read all the buffer and haven't found the terminator
      if (eosError) {
        throw (
          'End of stream reached, but no terminator ' + terminator + ' found'
        )
      } else {
        return this.mapUint8Array(i)
      }
    } else {
      let arr
      if (include) {
        arr = this.mapUint8Array(i + 1)
      } else {
        arr = this.mapUint8Array(i)
      }
      if (consume) {
        this.pos += 1
      }
      return arr
    }
  }

  public ensureFixedContents(expected: string | any[]) {
    let actual = this.readBytes(expected.length)
    if (actual.length !== expected.length) {
      throw new UnexpectedDataError(expected, actual)
    }
    let actLen = actual.length
    for (let i = 0; i < actLen; i++) {
      if (actual[i] !== expected[i]) {
        throw new UnexpectedDataError(expected, actual)
      }
    }
    return actual
  }

  public ensureBytesLeft(length: number) {
    if (this.pos + length > this.size) {
      throw new EOFError(length, this.size - this.pos)
    }
  }

  public mapUint8Array(length: number = 0) {
    this.ensureBytesLeft(length)
    let arr = new Uint8Array(this._buffer, this.byteOffset + this.pos, length)
    this.pos += length
    return arr
  }
}

class EOFError extends Error {
  bytesReq: any
  bytesAvail: any
  constructor(bytesReq: any, bytesAvail: number) {
    super()
    this.name = 'EOFError'
    this.message = `requested ${bytesReq} bytes, but only ${bytesAvail} bytes available`
    this.bytesReq = bytesReq
    this.bytesAvail = bytesAvail
    this.stack = new Error().stack
  }
}

// Unused since Kaitai Struct Compiler v0.9+ - compatibility with older versions
class UnexpectedDataError extends Error {
  expected: any
  actual: any
  constructor(expected: any, actual: Uint8Array) {
    super()
    this.name = 'UnexpectedDataError'
    this.message = `expected [ ${expected} ], but got [ ${actual} ]`
    this.expected = expected
    this.actual = actual
    this.stack = new Error().stack
  }
}

class UndecidedEndiannessError extends Error {
  constructor() {
    super()
    this.name = 'UndecidedEndiannessError'
    this.stack = new Error().stack
  }
}

class ValidationNotEqualError extends Error {
  expected: any
  actual: any
  constructor(expected: any, actual: any) {
    super()
    this.name = 'ValidationNotEqualError'
    this.message = `not equal, expected [ ${expected} ], but got [ ${actual} ]`
    this.expected = expected
    this.actual = actual
    this.stack = new Error().stack
  }
}

class ValidationLessThanError extends Error {
  min: any
  actual: any
  constructor(min: any, actual: any) {
    super()
    this.name = 'ValidationLessThanError'
    this.message = `not in range, min [ ${min} ], but got [ ${actual} ]`
    this.min = min
    this.actual = actual
    this.stack = new Error().stack
  }
}

class ValidationGreaterThanError extends Error {
  max: any
  actual: any
  constructor(max: string, actual: string) {
    super()
    this.name = 'ValidationGreaterThanError'
    this.message = `not in range, max [ ${max} ], but got [ ${actual} ]`
    this.max = max
    this.actual = actual
    this.stack = new Error().stack
  }
}

class ValidationNotAnyOfError extends Error {
  actual: any
  constructor(actual: string, io: any, srcPath: any) {
    super()
    this.name = 'ValidationNotAnyOfError'
    this.message = `not any of the list, got [ ${actual} ]`
    this.actual = actual
    this.stack = new Error().stack
  }
}

class ValidationExprError extends Error {
  actual: any
  constructor(actual: string, io: any, srcPath: any) {
    super()
    this.name = 'ValidationExprError'
    this.message = `not matching the expression, got [ ${actual} ]`
    this.actual = actual
    this.stack = new Error().stack
  }
}

export = KaitaiStream
