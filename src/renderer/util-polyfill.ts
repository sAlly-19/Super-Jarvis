// Browser polyfill for 'util' required by @tensorflow-models/speech-commands ESM build
export function promisify(fn: any) {
  return function (...args: any[]) {
    return new Promise((resolve, reject) => {
      fn(...args, (err: any, res: any) => {
        if (err) reject(err)
        else resolve(res)
      })
    })
  }
}

export default {
  promisify
}

