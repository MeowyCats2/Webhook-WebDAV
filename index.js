import { v2 as webdav } from 'webdav-server'
import { WebFileSystem } from "./fileSystem.js"
const userManager = new webdav.SimpleUserManager();
const user = userManager.addUser('user', process.env.password, false);

const privilegeManager = new webdav.SimplePathPrivilegeManager();
privilegeManager.setRights(user, '/', [ 'all' ]);

const server = new webdav.WebDAVServer({
    httpAuthentication: new webdav.HTTPDigestAuthentication(userManager, 'Default realm'),
    privilegeManager: privilegeManager
});
server.setFileSystemSync('/', new WebFileSystem('http://www.stuffedcupcakes.com/wp-content/uploads/2013/05/Chocolate-Overload.jpg'));
server.start(() => console.log('Ready'));