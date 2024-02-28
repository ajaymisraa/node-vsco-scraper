# node-vsco-scraper
I made this in one and a half hours off of a redbull from 12:30 am to 2:00 am, please excuse any flaws; it works as intended for now. As you can probably see in the jumbled code, there were ambitions that fell through. If you want, expand! It really isn't hard to. 

This was adapted by a python variant of a vsco scraper, https://github.com/mvabdi/vsco-scraper, I just made it in nodejs. I really only made this because my roommate told me I couldn't convert a 650 line python repository to javascript, a language that I hate and I am not the best at, before 3 a.m. This is living proof that it can kind of be done. Kind of. 

## Usage 

Really not that crazy. There are other usages like showing journals and collections but this is the main one that I cared about and that I could use for my website so it really only applied to be relevant. Other methods, like for journals, has functionality, though. 
```nodejs
const scraper = new Scraper('vsco name'); 

    async function runScraper() {
        await scraper.init(); 
        const images = await scraper.getImages();
        console.log(images);
        // this returns a json of all imgs and img data of the vsco account in question. 
    }
    
    runScraper().catch(console.error);
```
