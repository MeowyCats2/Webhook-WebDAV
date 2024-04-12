const cache = new Map();
const registry = new FinalizationRegistry((key) => {
  if (!cache.get(key)?.deref()) {
    cache.delete(key);
  }
});
const getCache = (key) => {
  if (cache.has(key)) {
    return cache.get(key).deref();
  };
  return null;
}
const setCache = (key, value) => {
  cache.set(key, new WeakRef(value));
  registry.register(value, key);
  return value;
};
const deleteCache = (key) => {
  cache.delete(key);
}
const throwOn4xx = async (res) => {
	if (res.status >= 400 && res.status < 500) {
		console.error(res)
		console.error(await res.text())
		throw new Error(res.status)
	}
	return res
}
const deletedIds = []
const key = await crypto.subtle.importKey("jwk", JSON.parse(process.env.key), {'name': 'AES-CBC', 'length': 256}, false, ['encrypt', 'decrypt'])
const send_file = async (blob, name) => {
  const formData = new FormData();
  formData.append('payload_json', JSON.stringify({}));
  formData.append('file', blob, name);
  const response = await throwOn4xx(await fetch(process.env.webhook + "?wait=true", {
      method: 'POST',
      body: formData,
  }));
  return await response.json();
}
const edit_msg = async (id, blob, name) => {
  const formData = new FormData();
  formData.append('payload_json', JSON.stringify({
    "attachments": []
  }));
  formData.append('file', blob, name);
  const response = await fetch(process.env.webhook + "/messages/" + id, {
      method: 'PATCH',
      body: formData,
  });
  return await response.json();
}
export const getEntry = async (id) => {
  const cached = getCache(id);
  if (cached) return cached;
  try {
    const msg = (await (await fetch(process.env.webhook + "/messages/" + id, {"cache": "no-store"})).json())
    const data = await (await fetch(msg.attachments[0].url)).json()
    return setCache(id, data)
  } catch (e) {
    return null
  }
  /*
  if (data.type !== "folder") return setCache(id, data)
  const entries = []
  for (const entry of data.contents) {
    console.log(entry)
    const entryMsg = (await (await fetch(process.env.webhook + "/messages/" + entry.metadata, {"cache": "no-store"})).json())
    entries.push({"id": entry.metadata, "content": await (await fetch(entryMsg.attachments[0].url)).json()})
  }
  return setCache(id, {"type": data.type, "name": data.name, "contents": entries})*/
}
export const entryFromPath = async (paths) => {
  const joined = paths.join(",")
  const cached = getCache(joined);
  if (cached) {
	  if (deletedIds.includes(cached.id)) {
		  console.log("Uncaching...")
		  deleteCache(joined)
	  } else {
		  return {...(await getEntry(cached.id)), "id": cached.id};
	  }
  }
  let last = await getEntry(process.env.root)
  let id = process.env.root
  for (let path of paths) {
    const found = last.contents.find(entry => entry.name === path)
    if (!found) {
      console.warn(paths)
      console.warn("error")
      return null
    }
    last = await getEntry(found.metadata)
    id = found.metadata
  }
  if (!last) return null
  last.id = id
  return setCache(joined, {"id": last.id})
}
export const downloadFile = async (data) => {
  console.log(data)
  const cached = getCache(data.id + "d");
  if (cached) return cached;
  const blobs = []
  for (let partId of data.parts) {
    const partMsg = await (await fetch(process.env.webhook + "/messages/" + partId, {"cache": "no-store"})).json()
    blobs.push(await (await fetch(partMsg.attachments[0].url)).blob())
  }
  console.log(blobs)
  const encrypted = new Blob(blobs)
  const blob = new Blob([new Uint8Array(await crypto.subtle.decrypt({ 'name': 'AES-CBC', 'iv': new Uint8Array(data.iv)}, key, await encrypted.arrayBuffer()))])
  const buffer = Buffer.from(await blob.arrayBuffer())
  if (buffer.size < 8 * 1024 * 1024) setCache(data.id + "d", buffer)
  return buffer
}
export const createFile = async (file, filename) => {
  const iv = crypto.getRandomValues(new Uint8Array(16))
  const encrypted = new Blob([new Uint8Array(await crypto.subtle.encrypt({ 'name': 'AES-CBC', iv}, key, await file.arrayBuffer()))])
  const parts = []
  for (let i = 0; i < encrypted.size; i += 1000 * 1000 * 24) {
      console.log(i)
      console.log(i / encrypted.size * 100 + "%")
      const res = await send_file(encrypted.slice(i, i + 1000 * 1000 * 24), "data.bin")
      parts.push(res.id)
  }
  const message = await send_file(new Blob([JSON.stringify({
      type: "file",
      name: filename,
      size: file.size,
      parts: parts,
      iv: [...iv]
  })]), "file.json");
  return message
}
export const createFolder = async (name) => {
  const message = await send_file(new Blob([JSON.stringify({
      type: "folder",
      name: name,
      contents: []
  })]), "file.json");
  return message
}
export const appendToFolder = async (type, entryId, folderId, name) => {
  const folderMsg = (await (await fetch(process.env.webhook + "/messages/" + folderId, {"cache": "no-store"})).json())
  const folderData = await (await fetch(folderMsg.attachments[0].url)).json()
  folderData.contents.push({"type": type, "metadata": entryId, "name": name})
  await edit_msg(folderId, new Blob([JSON.stringify(folderData)]), "file.json")
  setCache(folderId, folderData)
	console.log(folderData)
	console.log("Entry " + entryId + " appended")
	console.log((await (await fetch(process.env.webhook + "/messages/" + entryId, {"cache": "no-store"})).json()))
}
export const deleteEntry = async (entry, parent) => {
  console.log("Deletion!")
  deletedIds.push(entry.id)
  if (entry.type === "file") {
    for (let partId of entry.parts) {
      await fetch(process.env.webhook + "/messages/" + partId, {"method": "DELETE"})
    }
  } else {
    for (let partial of entry.contents) {
      await deleteEntry(await (await fetch(process.env.webhook + "/messages/" + partId, {"cache": "no-store"})).json(), partial.metadata)
    }
  }
  await fetch(process.env.webhook + "/messages/" + entry.id, {"method": "DELETE"})
  const folderMsg = (await (await fetch(process.env.webhook + "/messages/" + parent.id, {"cache": "no-store"})).json())
  const folderData = await (await fetch(folderMsg.attachments[0].url)).json()
  folderData.contents.splice(folderData.contents.findIndex(c => entry.id === c.metadata), 1)
  console.log(folderData)
  await edit_msg(parent.id, new Blob([JSON.stringify(folderData)]), "file.json")
  setCache(parent.id, folderData)
}
export const messageFromPath = async (path) => {
	console.log("messageFromPath")
	console.log("mfp: " + (await entryFromPath(path)).id)
  if (deletedIds.includes((await entryFromPath(path)).id)) return null
  console.log(deletedIds)
  return await (await throwOn4xx(await fetch(process.env.webhook + "/messages/" + (await entryFromPath(path)).id, {"cache": "no-store"}))).json()
}
export const moveEntry = async (entry, fromId, toId) => {
  const fromMsg = await getEntry(fromId)
  const fromData = await (await fetch(fromMsg.attachments[0].url)).json()
  fromData.contents.splice(fromData.contents.find(c => entry.id === c.metadata), 1)
  await edit_msg(fromId, new Blob([JSON.stringify(fromData)]), "file.json")
  setCache(fromId, fromData)
  await appendToFolder(entry.type, entry.id, toId, entry.name)
}
export const renameEntry = async (entryId, parentId, newName) => {
  const entryData = await getEntry(entryId)
  entryData.name = newName
  console.log(entryData)
  await edit_msg(entryId, new Blob([JSON.stringify(entryData)]), "file.json")
  setCache(entryId, entryData)
  const parentData = await getEntry(parentId)
  parentData.find(c => c.metadata === entryId).name = newName
  console.log(parentData)
  console.log(newName)
  await edit_msg(parentId, new Blob([JSON.stringify(parentData)]), "file.json")
}
export const fixFolder = async (folderId) => {
  const folderMsg = (await (await fetch(process.env.webhook + "/messages/" + folderId, {"cache": "no-store"})).json())
	console.log(folderMsg)
  const folderData = await (await fetch(folderMsg.attachments[0].url)).json()
  let newContents = []
  for (const entry of folderData.contents) {
	if (await getEntry(entry.metadata)) newContents.push(entry)
  }
  folderData.contents = newContents
  await edit_msg(folderId, new Blob([JSON.stringify(folderData)]), "file.json")
  setCache(folderId, folderData)
}

console.log("m")
console.log((await createFolder("Root")).id)
//console.log(await entryFromPath(["Create your account.png"]))
console.log(await fixFolder(process.env.root))
console.log(await getEntry(process.env.root))
console.log((await entryFromPath([])).id)
//console.log(await appendToFolder((await createFile(new Blob(["meow"]), "meow.txt")).id, (await entryFromPath([])).id))