// Temporary copy of the respective impls in cds.utils, until we can reliably expect to reuse that
/* eslint-disable no-await-in-loop */

const { open, unlink, readFile:read, writeFile:write, rename } = require('node:fs/promises')
const { setTimeout: sleep } = require('node:timers/promises')

exports.lock = async function (file, retries = 10, delay = 20) {
  for (let i = 0; i < retries; i++) try {
    const handle = await open (file+'.lock', 'wx')
    await handle.close()
    return {release:() => unlink (file+'.lock') .catch (err => {
      if (err.code !== 'ENOENT') throw err // ignore if already deleted
    })}
  } catch (err) {
    if (err.code === 'EEXIST') await sleep (delay)
    else throw err
  }
  throw new Error('Could not acquire lock: connection timed out')
}


exports.edit = async function (json_file, callback, ifAbsent = ()=>({})) {
  const lock = await exports.lock (json_file)
  try {
    const data = await read (json_file, 'utf8') .then (JSON.parse, ifAbsent)
    const edited = callback(data); if (!edited) return
    const json = JSON.stringify (edited, null, 2)
    const temp_file = `${json_file}.${process.pid}.tmp`
    await write (temp_file, json, 'utf8')
    await rename (temp_file, json_file)
  } catch (error) {
    throw new Error (`Failed to update ${json_file}!`, { cause: error })
  } finally {
    await lock.release()
  }
}

module.exports = Object.assign (exports.edit, exports)
