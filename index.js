const axios = require('axios');
const fs = require('fs'); 
const fsp = require('fs/promises'); 
const path = require('path');
const { visituserinfo, media } = require('./constants');
const CliProgress = require('cli-progress');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');

let cache = {};
let latestCache = {};

async function checkFileExists(filePath) {
    try {
        await fsp.access(filePath);
        return true; 
    } catch {
        return false; 
    }
}


// Scraper Class
class Scraper {
    constructor(username) {
        this.username = username;
        this.session = axios.create({
            headers: visituserinfo 
        });
        this.siteid = null;
        this.sitecollectionid = null;
        this.mediaurl = '';
        this.journalurl = '';
        this.collectionurl = '';
        this.profileurl = '';
        this.imagelist = []; 
        this.works = []; 
        if (!cache) {
            cache = {};
        }
        if (!latestCache) {
            latestCache = {};
        }
        
    }

    async init() {
        const timestamp = Date.now();
        await this.session.get(`http://vsco.co/content/Static/userinfo?callback=jsonp_${timestamp}_0`);
        const dirPath = path.join(process.cwd(), this.username);
        try {
            await fsp.access(dirPath);
        } catch (error) {
            await fsp.mkdir(dirPath, { recursive: true });
        }
        process.chdir(dirPath);
        await this.newSiteId();
        this.buildJSON();
        this.totalj = 0;
    }

    async newSiteId() {
        if (latestCache && !latestCache[this.username]) {
            latestCache[this.username] = { images: {}, collection: {}, journal: {}, profile: {} };
        } else if (latestCache && !latestCache[this.username]["profile"]) {
            latestCache[this.username]["profile"] = {};
        }

        if (!cache || !cache[this.username]) {
            try {
                const response = await this.session.get(`http://vsco.co/api/2.0/sites?subdomain=${this.username}`);
                const data = response.data;
                this.siteid = data.sites[0].id;
                this.sitecollectionid = data.sites[0].site_collection_id;
                cache[this.username] = [this.siteid, this.sitecollectionid];
            } catch (error) {
                console.error("Failed to fetch new site ID:", error);
            }
        } else {
            this.siteid = cache[this.username][0];
            this.sitecollectionid = cache[this.username][1];
        }

        return this.siteid;
    }

    buildJSON() {
        this.mediaurl = `http://vsco.co/api/2.0/medias?site_id=${this.siteid}`;
        this.journalurl = `http://vsco.co/api/2.0/articles?site_id=${this.siteid}`;
        this.collectionurl = `http://vsco.co/api/2.0/collections/${this.sitecollectionid}/medias?`;
        this.profileurl = `http://vsco.co/api/2.0/sites/${this.siteid}`;
        
        return this.mediaurl;
    }

    async getProfile() {
        this.imagelist = [];
        const profilePath = path.join(process.cwd(), this.username, "profile");
        try {
            await fsp.access(profilePath);
        } catch {
            await fsp.mkdir(profilePath, { recursive: true });
        }
        process.chdir(profilePath);

        // Using cli-progress as a substitute for tqdm
        const progressBar = new CliProgress.SingleBar({}, CliProgress.Presets.shades_classic);
        progressBar.start(100, 0, {
            desc: `Finding if a new profile picture exists from ${this.username}`
        });

        await this.makeProfileList();

        progressBar.stop();

        // Download profile pictures
        const downloadProgressBar = new CliProgress.SingleBar({}, CliProgress.Presets.shades_classic);
        downloadProgressBar.start(this.imagelist.length, 0, {
            desc: `Downloading a new profile picture from ${this.username}`
        });

        for (const image of this.imagelist) {
            try {
                await this.download_img_normal(image); // Assuming this method is defined to handle the download
                downloadProgressBar.increment();
            } catch (error) {
                console.error(`${this.username} crashed ${error}`);
            }
        }

        downloadProgressBar.stop();
        process.chdir(".."); // Going back to the previous directory
    }

    async makeProfileList() {
        const response = await this.session.get(this.profileurl, { headers: media });
        const url = response.data.site;
    
        // Assuming latestCache is defined and managed globally
        if (latestCache && !latestCache[this.username]["profile"][url["profile_image_id"]]) {
            latestCache[this.username]["profile"][url["profile_image_id"]] = new Date().toISOString().slice(0, 10); // Using ISO string for the date
        }
    
        // Use fs.existsSync for synchronous check
        if (!url["profile_image_id"] || fs.existsSync(`${url["profile_image_id"]}.jpg`)) {
            return true;
        }
    
        this.imagelist.push({
            url: `http://${url["responsive_url"]}`,
            id: url["profile_image_id"],
            isVideo: false
        });
    
        // No direct pbar.update() equivalent in cli-progress, increment handled in loop
        return true;
    }
    

    async makeCollectionList(num) {
        let pageNumber = num + 1;
        let morePagesAvailable = true;

        while (morePagesAvailable) {
            const response = await this.session.get(this.collectionurl, {
                params: { size: 100, page: pageNumber }
            });

            const medias = response.data.medias;
            morePagesAvailable = medias.length > 0;

            for (const media of medias) {
                const uploadDate = media.upload_date.slice(0, -3);
                const fileNameJpg = `${uploadDate}.jpg`;
                const fileNameMp4 = `${uploadDate}.mp4`;
                const filePathJpg = path.join(process.cwd(), fileNameJpg);
                const filePathMp4 = path.join(process.cwd(), fileNameMp4);

                if (latestCache && latestCache[this.username] && latestCache[this.username]["collection"][uploadDate]) {
                    continue;
                } else {
                    latestCache[this.username]["collection"][uploadDate] = new Date().toISOString().slice(0, 10);
                }

                if (await fsExists(filePathJpg) || await fsExists(filePathMp4)) {
                    continue;
                }

                this.imagelist.push({
                    url: `http://${media.is_video ? media.video_url : media.responsive_url}`,
                    uploadDate: uploadDate,
                    isVideo: media.is_video
                });
            }

            pageNumber += 5;
        }

        return true;
    }

    async getJournal() {
        await this.getJournalList();

        const progressBar = new CliProgress.SingleBar({}, CliProgress.Presets.shades_classic);
        progressBar.start(this.totalj, 0, {
            desc: `Downloading journal posts from ${this.username}`
        });

        for (const work of this.works) {
            const workPath = path.join(process.cwd(), work[0]);
            try {
                await fs.access(workPath);
            } catch {
                await fs.mkdir(workPath, { recursive: true });
            }
            process.chdir(workPath);

            const downloadPromises = work.slice(1).map(part => this.download_img_journal(part));
            await Promise.all(downloadPromises.map(p => p.catch(e => console.error(`Failed to download: ${e}`))));
            
            progressBar.increment(downloadPromises.length); 
            process.chdir('..'); 
        }

        progressBar.stop();
    }

    async getJournalList() {
        const response = await this.session.get(this.journalurl, { params: { size: 10000, page: 1 } });
        this.jour_found = response.data.articles;
    
        const journalPath = path.join(process.cwd(), "journal");
        try {
            await fsp.access(journalPath);
        } catch {
            await fsp.mkdir(journalPath, { recursive: true });
        }
        process.chdir(journalPath);
    
        for (const article of this.jour_found) {
            this.works.push([article.permalink]);
        }
    }

    async makeListJournal(num, loc) {
        const response = await this.session.get(this.journalurl, { params: { size: 10000, page: 1 } });
        const articles = response.data.articles;
        for (const article of articles) {
            const permalinkPath = path.join(process.cwd(), article.permalink);
            if (!await fileExists(permalinkPath)) {
                await fs.promises.mkdir(permalinkPath, { recursive: true });
            }
            for (const item of article.body) {
                // Assuming latestCache management is done elsewhere
                const itemId = item.type === "text" ? `${item.content}.txt` : `${item.content[0].id}.${item.type === "image" ? "jpg" : "mp4"}`;
                if (!await fileExists(path.join(permalinkPath, itemId))) {
                    this.works.push({
                        permalink: article.permalink,
                        item: item,
                        type: item.type
                    });
                    this.totalj++;
                }
            }
        }
    }

    async download_img_journal(list) {
        const { permalink, item, type } = list;
        const basePath = path.join(process.cwd(), permalink);
        const fileName = type === "text" ? `${item.content}.txt` : `${item.content[0].id}.${type === "image" ? "jpg" : "mp4"}`;
        const filePath = path.join(basePath, fileName);

        if (!await fileExists(filePath)) {
            if (type === "text") {
                await fs.promises.writeFile(filePath, item.content);
            } else {
                const response = await axios.get(item.content[0].type === "image" ? item.content[0].responsive_url : item.content[0].video_url, { responseType: 'stream' });
                response.data.pipe(fs.createWriteStream(filePath));
                return new Promise((resolve, reject) => {
                    response.data.on('end', () => resolve());
                    response.data.on('error', reject);
                });
            }
        }
    }

    async download_img_normal(list) {
        const { url, id, isVideo } = list; 
        const extension = isVideo ? 'mp4' : 'jpg';
        const filePath = path.join(process.cwd(), this.username, `${id}.${extension}`);

        if (await exists(filePath)) {
            console.log(`${filePath} already exists.`);
            return;
        }

        try {
            const response = await axios.get(url, { responseType: 'stream' });
            const writer = fs.createWriteStream(filePath);

            response.data.pipe(writer);

            return new Promise((resolve, reject) => {
                writer.on('finish', resolve);
                writer.on('error', reject);
            });
        } catch (error) {
            console.error(`Error downloading file ${id}: ${error}`);
        }
    }

    async getImages() {
        console.log(`Finding new posts from ${this.username}`);
        let allNewItems = []; 
    
        const tasks = [];
        for (let num = 0; num < 5; num++) {
            tasks.push(this.makeImageList(num));
        }
    
        try {
            const results = await Promise.all(tasks);
            for (const items of results) {
                allNewItems = allNewItems.concat(items); 
            }
        } catch (error) {
            console.error(`A task failed: ${error}`);
        }
    
        console.log('Finished finding new posts.');
        return allNewItems; 
    }
    

    async getImageList() {
        console.log(`Finding new posts from ${this.username}`);
        const tasks = [];
        for (let num = 0; num < 5; num++) {
            tasks.push(this.makeImageList(num));
        }

        try {
            await Promise.all(tasks);
        } catch (error) {
            console.error(`A task failed: ${error}`);
        }

        console.log('Finished finding new posts.');
    }

    async makeImageList(num) {
        let pageNumber = num + 1;
        let hasMore = true;
        let allItems = [];
    
        while (hasMore) {
            const response = await this.session.get(this.mediaurl, {
                params: { size: 100, page: pageNumber }
            });
            const mediaItems = response.data.media;
            hasMore = mediaItems.length > 0;
    
            for (const item of mediaItems) {
                allItems.push(item);
                /*
                if (typeof item.upload_date === 'string') {
                    const uploadDate = item.upload_date.slice(0, -3);
                    const fileExists = await this.checkFileExists(`${uploadDate}.${item.is_video ? 'mp4' : 'jpg'}`);
    
                    if (!fileExists) {
                        const newItem = {
                            url: `http://${item.is_video ? item.video_url : item.responsive_url}`,
                            uploadDate: uploadDate,
                            isVideo: item.is_video
                        };
                        newItems.push(newItem);
                        this.imagelist.push(newItem); // You might want to adjust this depending on your logic
                    }
                } else {
                    console.error('upload_date is not a string:', item);
                }
                */
            }
    
            pageNumber += 5; // Increment to fetch next set of items
        }
        return allItems;
    }
    

    async run_all() {
        await this.getImages();
        await this.getCollection();
        await this.getJournal();
    }

    async run_all_profile() {
        await this.getImages();
        await this.getCollection();
        await this.getJournal();
        await this.getProfile();
    }

}

async function openCache(file) {
    try {
        const data = await fs.readFile(file, { encoding: 'utf-8' });
        cache = JSON.parse(data);
    } catch (error) {
        cache = {};
    }
}

async function updateCache(file) {
    try {
        await fs.writeFile(file, JSON.stringify(cache, null, 4), { encoding: 'utf-8' });
    } catch (error) {
        console.error('Failed to update cache:', error);
    }
}

async function openLatestCache(file) {
    try {
        const data = await fs.readFile(file, { encoding: 'utf-8' });
        latestCache = JSON.parse(data);
    } catch (error) {
        latestCache = {};
    }
}

const argv = yargs(hideBin(process.argv))
    .usage('Scrapes a specified users VSCO Account')
    .option('username', {
        describe: 'VSCO user to scrape or file name to read usernames off of. Filename feature works with -m, -mc, -mj, and -a only',
        type: 'string'
    })
    .option('s', {
        alias: 'siteId',
        describe: 'Grabs VSCO siteID for user',
        type: 'boolean'
    })
    .option('i', {
        alias: 'getImages',
        describe: 'Get the pictures of the user',
        type: 'boolean'
    })
    .option('j', {
        alias: 'getJournal',
        describe: 'Get the journal images of the user',
        type: 'boolean'
    })
    .option('p', {
        alias: 'getProfilePicture',
        describe: 'Get the profile picture of the user',
        type: 'boolean'
    })
    .option('c', {
        alias: 'getCollection',
        describe: 'Get the collection images of the user',
        type: 'boolean'
    })
    .option('m', {
        alias: 'multiple',
        describe: 'Scrape images from multiple users',
        type: 'boolean'
    })
    .option('mj', {
        alias: 'multipleJournal',
        describe: 'Scrape multiple users journal posts',
        type: 'boolean'
    })
    .option('mc', {
        alias: 'multipleCollection',
        describe: 'Scrape multiple users collection posts',
        type: 'boolean'
    })
    .option('mp', {
        alias: 'multipleProfile',
        describe: 'Scrape multiple users profile pictures',
        type: 'boolean'
    })
    .option('a', {
        alias: 'all',
        describe: 'Scrape multiple users images, journals, and collections',
        type: 'boolean'
    })
    .option('ap', {
        alias: 'allProfile',
        describe: 'Scrape multiple users images, journals, collections, and profile pictures',
        type: 'boolean'
    })
    .option('ch', {
        alias: 'cacheHit',
        describe: 'Caches site id in case of a username switch',
        type: 'boolean'
    })
    .option('l', {
        alias: 'latest',
        describe: 'Only downloads media one time, and makes sure to cache the media',
        type: 'boolean'
    })
    .argv;

    async function main() {
        const argv = yargs(hideBin(process.argv)).options({
            username: { type: 'string', demandOption: true, describe: 'VSCO user to scrape' },
            siteId: { type: 'boolean', describe: 'Grabs VSCO siteID for user' },
            getImages: { type: 'boolean', describe: 'Get the pictures of the user' },
            getJournal: { type: 'boolean', describe: 'Get the journal images of the user' },
            getProfilePicture: { type: 'boolean', describe: 'Get the profile picture of the user' },
            getCollection: { type: 'boolean', describe: 'Get the collection images of the user' },
            multiple: { type: 'boolean', describe: 'Scrape images from multiple users' },
            multipleJournal: { type: 'boolean', describe: 'Scrape multiple users journal posts' },
            multipleCollection: { type: 'boolean', describe: 'Scrape multiple users collection posts' },
            multipleProfile: { type: 'boolean', describe: 'Scrape multiple users profile pictures' },
            all: { type: 'boolean', describe: 'Scrape multiple users images, journals, and collections' },
            allProfile: { type: 'boolean', describe: 'Scrape multiple users images, journals, collections, and profile pictures' },
            cacheHit: { type: 'boolean', describe: 'Caches site id in case of a username switch' },
            latest: { type: 'boolean', describe: 'Only downloads media one time, and makes sure to cache the media' }
        }).argv;
    
        // Initialize cache based on command line arguments
        if (argv.latest) {
            await openLatestCache(`${argv.username}_latest_cache_store`);
        }
    
        if (argv.cacheHit) {
            await openCache(`${argv.username}_cache_store`);
        }
    
        const scraper = new Scraper(argv.username);
    
        if (argv.siteId) {
            console.log("aaaas")
            console.log(await scraper.newSiteId());
        }
    
        if (argv.getImages) {
            await scraper.getImages();
        }
    
        if (argv.getJournal) {
            await scraper.getJournal();
        }
    
        if (argv.getCollection) {
            await scraper.getCollection();
        }
    
        if (argv.getProfilePicture) {
            await scraper.getProfile();
        }
    
        if (argv.multiple || argv.multipleJournal || argv.multipleCollection || argv.multipleProfile || argv.all || argv.allProfile) {
            const usernames = await fs.readFile(argv.username, 'utf8');
            const users = usernames.split('\n').filter(Boolean);
    
            for (const user of users) {
                const multiScraper = new Scraper(user.trim());
                try {
                    if (argv.multiple || argv.all || argv.allProfile) {
                        await multiScraper.getImages();
                    }
                    if (argv.multipleJournal || argv.all || argv.allProfile) {
                        await multiScraper.getJournal();
                    }
                    if (argv.multipleCollection || argv.all || argv.allProfile) {
                        await multiScraper.getCollection();
                    }
                    if (argv.multipleProfile || argv.allProfile) {
                        await multiScraper.getProfile();
                    }
                } catch (error) {
                    console.error(`${user} crashed: ${error}`);
                }
            }
        }
    
        if (argv.cacheHit) {
            await updateCache(`${argv.username}_cache_store`);
        }
    
        if (argv.latest) {
            await updateLatestCache(`${argv.username}_latest_cache_store`);
        }
    }



    /* 

    Example Case

    */


    /*
    const scraper = new Scraper('NAME'); 

    async function runScraper() {
        await scraper.init(); 
        const images = await scraper.getImages();
        // console.log(images); 
    }
    
    runScraper().catch(console.error);

    */

