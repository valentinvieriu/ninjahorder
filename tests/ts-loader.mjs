import { access } from 'node:fs/promises'
import { dirname, extname, resolve as resolvePath } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const rootDir = resolvePath(dirname(fileURLToPath(import.meta.url)), '..')
const extensions = ['.ts', '.js', '.mjs']

const fileExists = async (path) => {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

const resolveWithExtension = async (basePath) => {
  if (extname(basePath) && await fileExists(basePath)) return basePath

  for (const extension of extensions) {
    const candidate = `${basePath}${extension}`
    if (await fileExists(candidate)) return candidate
  }

  return null
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('~/')) {
    const candidate = await resolveWithExtension(resolvePath(rootDir, specifier.slice(2)))
    if (candidate) {
      return {
        shortCircuit: true,
        url: pathToFileURL(candidate).href,
      }
    }
  }

  if ((specifier.startsWith('./') || specifier.startsWith('../')) && !extname(specifier)) {
    const parentPath = context.parentURL ? fileURLToPath(context.parentURL) : rootDir
    const candidate = await resolveWithExtension(resolvePath(dirname(parentPath), specifier))
    if (candidate) {
      return {
        shortCircuit: true,
        url: pathToFileURL(candidate).href,
      }
    }
  }

  return nextResolve(specifier, context)
}
