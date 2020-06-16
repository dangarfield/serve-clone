#!/usr/bin/env node

const axios = require('axios')
const asyncPool = require('tiny-async-pool')
const path = require('path')
const fs = require('fs-extra')
const cliProgress = require('cli-progress')
const arg = require('arg')
const chalk = require('chalk')
const _colors = require('colors')

const CONCURRENCY = 10

let dlProgressBar
let scrapeProgressBar

const chalkInfo = (message) => chalk`{cyan INFO:} ${message}`
const chalkError = (message) => chalk`{red ERROR:} ${message}`

const scrapeServePage = async (serveURL, relativePath, folders, files) => {
  let scrapeUrl = serveURL
  if (!scrapeUrl.endsWith('/')) {
    scrapeUrl = scrapeUrl + '/'
  }
  if (relativePath.length > 0) {
    scrapeUrl = scrapeUrl + relativePath.join('/') + '/'
  }

  const res = await axios(scrapeUrl)
  for (let i = 0; i < res.data.files.length; i++) {
    const file = res.data.files[i]
    if (file.type === 'file') {
      files.push({name: file.base, path: relativePath})
    } else if (file.type === 'folder') {
      let relativePathCopy = [...relativePath]
      file.base = file.base.slice(0, -1) // Remove trailing slash
      relativePathCopy.push(file.base)
      const folderName = relativePathCopy.join('/')
      folders.push(folderName)
      await scrapeServePage(serveURL, relativePathCopy, folders, files)
    }
    scrapeProgressBar.update(files.length)
  }
}

const getAllDirectoriesAndFilesFromServe = async (serveURL) => {
  let folders = []
  let files = []

  scrapeProgressBar = new cliProgress.SingleBar({
    format: _colors.cyan('INFO: ') + 'Identifying files |' + _colors.cyan('{bar}') + '| {percentage}% || {value}/{total} Files',
    barCompleteChar: '\u2588',
    barIncompleteChar: '\u2591',
    hideCursor: true
  })

  scrapeProgressBar.start(100000, 0) // Set to 10,000 by default, not pretty UI, but it's fine

  await scrapeServePage(serveURL, [], folders, files)

  scrapeProgressBar.setTotal(files.length)
  scrapeProgressBar.stop()
  return files
}
const downloadFile = async (fileData) => {
  dlProgressBar.update(fileData.i)

  const url = fileData.url
  const filePath = fileData.filePath

  const parentDir = path.resolve(filePath, '..')
  await fs.ensureDir(parentDir)
  let alreadyExists = await fs.exists(filePath)
  if (!alreadyExists) {
    const writer = fs.createWriteStream(filePath)
    try {
      const response = await axios({
        url,
        method: 'GET',
        responseType: 'stream'
      })
      response.data.pipe(writer)

      return new Promise((resolve, reject) => {
        writer.on('finish', () => {
          resolve(`Finished downloading - ${url} - ${filePath}`)
        })
        writer.on('error', reject)
      })
    } catch (error) {
      await fs.unlink(filePath)
      return `Failed to download - ${url} - ${filePath}`
    }
  } else {
    return `Already downloaded - ${url} - ${filePath}`
  }
}

const downloadFiles = async (serveURL, files, baseDirectory) => {
  let fileDatas = []
  for (let i = 0; i < files.length; i++) {
    const file = files[i]

    let urlPath = [...file.path]
    urlPath.unshift(serveURL)
    urlPath.push(file.name)
    const url = urlPath.join('/')

    let filePath = [...file.path]
    filePath.unshift(baseDirectory)
    filePath.push(file.name)
    let filePathString = filePath.join(path.sep)
    fileDatas.push({url: url, filePath: filePathString, i: i + 1, c: files.length})
  }
  dlProgressBar = new cliProgress.SingleBar({
    format: _colors.cyan('INFO: ') + 'Downloading files |' + _colors.cyan('{bar}') + '| {percentage}% || {value}/{total} Files',
    barCompleteChar: '\u2588',
    barIncompleteChar: '\u2591',
    hideCursor: true
  })
  dlProgressBar.start(fileDatas.length, 0)

  const results = await asyncPool(CONCURRENCY, fileDatas, downloadFile)

  dlProgressBar.stop()

  let resultCounts = {downloaded: 0, already: 0, errors: 0, errorMsg: []}
  for (let i = 0; i < results.length; i++) {
    const result = results[i]
    if (result.startsWith('Finished')) {
      resultCounts.downloaded++
    } else if (result.startsWith('Already')) {
      resultCounts.already++
    } else if (result.startsWith('Failed')) {
      resultCounts.errors++
      resultCounts.errorMsg.push(result)
    }
  }
  return resultCounts
}

const isUrlAvailable = async (urlString) => {
  try {
    const res = await axios(urlString)
    if (res.data.directory.length > 0) {
      return true
    } else {
      return false
    }
  } catch (err) {
    return false
  }
}
const isUrlValid = async (urlString) => {
  let url
  try {
    url = new URL(urlString)
  } catch (err) {
    return false
  }
  return url.protocol === 'http:' || url.protocol === 'https:'
}
const isDirectoryValid = async (baseDirectory) => {
  try {
    baseDirectory = path.parse(baseDirectory)
    return true
  } catch (error) {
    return false
  }
}
const pad = (width, string, padding) => {
  return (width <= string.length) ? string : pad(width, padding + string, padding)
}

const cloneInit = async (serveURL, baseDirectory) => {
  const validUrl = await isUrlValid(serveURL)
  if (!validUrl) {
    console.error(chalkError(`URL is not valid -> ${serveURL}`))
    return
  }

  const urlAvailable = await isUrlAvailable(serveURL)
  if (!urlAvailable) {
    console.error(chalkError(`URL is not available -> ${serveURL}`))
    return
  }

  const validDirectory = await isDirectoryValid(baseDirectory)
  if (!validDirectory) {
    console.error(chalkError(`Directory is not valid -> ${baseDirectory}`))
    return
  }

  baseDirectory = path.resolve(baseDirectory)

  console.log(chalk`{cyan INFO:} Cloning {yellow ${serveURL}} into {cyan ${baseDirectory}}`)

  try {
    let files = await getAllDirectoriesAndFilesFromServe(serveURL)
    let resultCounts = await downloadFiles(serveURL, files, baseDirectory)
    // console.log('resultCounts', resultCounts)
    console.log(chalkInfo(`Clone complete`))
    if (resultCounts.downloaded > 0) {
      console.log(chalkInfo(`  Downloaded         ${pad(8, resultCounts.downloaded, ' ')} files`))
    }
    if (resultCounts.already > 0) {
      console.log(chalkInfo(`  Already Downloaded ${pad(8, resultCounts.already, ' ')} files`))
    }
    if (resultCounts.errors > 0) {
      console.log(chalkInfo(`  Errors             ${pad(8, resultCounts.errors, ' ')} files`))
      let time = new Date()
      let logFileName = `serve-clone-errors-${time.getTime()}.log`
      let logFile = `URL:               ${serveURL}
Base Directory:    ${baseDirectory}
Time:              ${time}
--------------------------------------------------------------------------------
${resultCounts.errorMsg.join('\n')}
`
      await fs.outputFile(path.resolve(logFileName), logFile)
      console.error(chalk`{red ERR: } Error log: {red ${path.resolve(logFileName)}}`)
      console.error(chalk`{yellow WARN:} Errors typically occur when serve is not running with:
        {bold.yellow "cleanUrls": false} and {bold.yellow "symlinks": true}`)
    }
  } catch (error) {
    if (scrapeProgressBar) {
      scrapeProgressBar.stop()
    }
    if (dlProgressBar) {
      dlProgressBar.stop()
    }
    console.error(chalkError(`${error.message}`))
  }
}

const getHelp = () => chalk`
  {bold.cyan serve-clone} - Cloning directories through vercel {bold.cyan serve}

  {bold USAGE}
      {bold $} {cyan serve-clone} --help
      {bold $} {cyan serve-clone} --url http://serve.url/path --folder local_folder_name

      {cyan serve-clone} will download the files in a relative path unless
      explicitly stated by using a root identifier {bold /root/path}
  {bold OPTIONS}
      --help                              Shows this help message
      -u, --url                           The url of the {bold.cyan serve} server
      -f, --folder                        The folder where the serve directory contents will be cloned
  {bold NOTES}
      In order for single file directories and automatic .html pages to be listed correctly,
      Your {bold.cyan serve} config must be set to {bold "cleanUrls": false}

      In order for symlinked files to be downloaded correctly,
      Your {bold.cyan serve} config must be set to {bold "symlinks": true}
`;
(async () => {
  let args = null
  try {
    args = arg({
      '--help': Boolean,
      '--url': String,
      '--folder': String,
      '-h': '--help',
      '-u': '--url',
      '-f': '--folder'
    })
    if (args['--help']) {
      console.log(await getHelp())
      return
    }
    if (!args['--url']) {
      console.log('url')
      console.log(await getHelp())
      console.error(chalkError('Please provide an argument for the url of the serve\'s files: --url https://localhost:5000'))
      process.exit(1)
    }
    if (!args['--folder']) {
      console.log('folder')
      console.log(await getHelp())
      console.error(chalkError('Please provide an argument for the folder of the serve\'s files: --folder files/just-here'))
      process.exit(1)
    }
    cloneInit(args['--url'], args['--folder'])
  } catch (err) {
    console.error(chalkError(err.message))
    process.exit(1)
  }
})()

// const init = async () => {
//   await cloneInit('http://localhost:5000', 'files')
// }
