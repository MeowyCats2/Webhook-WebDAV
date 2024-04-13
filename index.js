import { v2 as webdav } from 'webdav-server'
import { WebhookFileSystem } from "./fileSystem.js"
const userManager = new webdav.SimpleUserManager();
const user = userManager.addUser('user', process.env.password, false);

const privilegeManager = new webdav.SimplePathPrivilegeManager();
privilegeManager.setRights(user, '/', [ 'all' ]);

const server = new webdav.WebDAVServer({
    httpAuthentication: new webdav.HTTPDigestAuthentication(userManager, 'Default realm'),
    privilegeManager: privilegeManager
});
server.setFileSystemSync('/', new WebhookFileSystem());
server.start(() => console.log('Ready'));