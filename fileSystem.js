import { v2 as webdav } from 'webdav-server'
import { Readable, Writable } from "node:stream"
import { getEntry, entryFromPath, downloadFile, createFile, createFolder, appendToFolder, deleteEntry, messageFromPath, moveEntry, renameEntry, fixFolder } from "./webhook.js"
// Serializer
function WebFileSystemSerializer()
{
    return {
        uid()
        {
            return "WebFileSystemSerializer_1.0.0";
        },
        serialize(fs, callback)
        {
            callback(null, {
                url: fs.url,
                props: fs.props
            });
        },
        unserialize(serializedData, callback)
        {
            const fs = new WebhookFileSystem(serializedData.url);
            fs.props = serializedData.props;
            callback(null, fs);
        },
        constructor: WebFileSystemSerializer
    }
}

// File system
export class WebhookFileSystem extends webdav.FileSystem {
  constructor (url) {
    super(new WebFileSystemSerializer());       this.props = new webdav.LocalPropertyManager();
    this.locks = new webdav.LocalLockManager();
  }
  async _fastExistCheck (ctx, path, callback) {
    callback(!!(await entryFromPath(path.paths)))
  }
  async _create (path, info, callback) {
    console.log(path)
    console.log(info.type)
    if (info.type.isDirectory) {
      const name = path.paths.at(-1)
      await appendToFolder("folder", (await createFolder(name)).id, (await entryFromPath(path.paths.slice(0, -1))).id, name)
      console.log("foldered")
    } else {
      const name = path.paths.at(-1)
      await appendToFolder("file", (await createFile(new Blob(), name)).id, (await entryFromPath(path.paths.slice(0, -1))).id, name)
    }
    callback()
  }
  async _delete (path, info, callback) {
    await deleteEntry(await entryFromPath(path.paths), await entryFromPath(path.paths.slice(0, -1)))
    console.log("deleted")
    callback()
  }
  async _openWriteStream (path, info, callback) {
    console.log("writing")
    const content = [];
    const stream = new webdav.VirtualFileWritable(content);
    stream.on('finish', async () => {
		console.log("finishing up")
      const filename = path.paths.at(-1)
	  if (await entryFromPath(path.paths)) {
		await deleteEntry(await entryFromPath(path.paths), await entryFromPath(path.paths.slice(0, -1)))
	  }
      await appendToFolder("file", (await createFile(new Blob(content), filename)).id, (await entryFromPath(path.paths.slice(0, -1))).id, filename)
      console.log("finished")
    })
    callback(null, stream)
  }
  async _openReadStream (path, info, callback) {
    callback(null, Readable.from(await downloadFile(await entryFromPath(path.paths))));
  }
  async _copy (from, to, info, callback) {
    const buffer = await downloadFile(await entryFromPath(from.paths))
    const name = from.paths.at(-1)
    await appendToFolder("file", (await createFile(new Blob([buffer]), name)).id, (await entryFromPath(to.paths.slice(0, -1))).id, name)
    callback()
  }
  async _move (from, to, info, callback) {
	const entry = await entryFromPath(from.paths)
	const oldParent = (await messageFromPath(from.paths.slice(0, -1))).id
	const newParent = (await messageFromPath(to.paths.slice(0, -1))).id
    if (oldParent !== newParent) await moveEntry(entry, oldParent, newParent)
	if (from.paths.at(-1) !== to.paths.at(-1)) await renameEntry(entry.id, newParent, to.paths.at(-1))
    callback()
  }
  async _rename (path, newName, info, callback) {
    console.log("rename")
    await renameEntry((await messageFromPath(path.paths)).id, (await messageFromPath(path.paths.slice(0, -1))).id, newName)
    callback()
  }
  async _readDir (path, info, callback) {
    const data = (await entryFromPath(path.paths))
    if (!data) {
      return callback(webdav.Errors.ResourceNotFound)
    }
	await fixFolder(data.id)
    callback(null, data.contents.map(entry => entry.name))
  }
  async _size (path, info, callback) {
    console.log("size")
    callback(null, (await entryFromPath(path.paths)).size)
  }
  async _creationDate (path, info, callback) {
    console.log("creation date")
	const data = (await messageFromPath(path.paths))
	if (!data) return callback(null)
    callback(null, (new Date(data.timestamp)).getTime())
  }
  async _lastModifiedDate (path, info, callback) {
    console.log("last modified date")
    await this._creationDate(path, info, callback)
  }
  _propertyManager (path, info, callback) {
    callback(null, this.props);
  }
  _lockManager (path, info, callback) {
    callback(null, this.locks);
  }
  async _type (path, info, callback) {
    if ((await entryFromPath(path.paths)).type === "folder") {
      callback(null, webdav.ResourceType.Directory);
    } else {
      callback(null, webdav.ResourceType.File);
    }
  }
}
