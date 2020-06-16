# serve-clone
> Clone files hosted on a vercel `serve` server to your local machine

![alt text](https://i.ibb.co/khzw2Xk/Screen-Shot-2019-12-15-at-09-20-01.png "Serve-clone")


## Usage
Install as a global module:
```bash
npm i -g serve-clone
```

Point towards your `serve` server and enter your local path for the cloning:
```bash
serve-clone --url http://localhost:5000 --folder files/just-here
```

This will download all the files to your machine and give you a live progress update

## Arguments:
      --help                Show the help message
      -u, --url             The url of the serve server
      -f, --folder          The folder where the serve directory contents will be cloned


## Notes
In order for single file directories and automatic .html pages to be listed correctly,
Your `serve` config must be set to `{"cleanUrls": false}`. At the current time, this options has to be set using a config files as CLI argument is not available (`serve@11`).

In order for symlinked files to be downloaded correctly,
Your `serve` config must be set to `{"symlinks": true}`. At the current time, this has to be through the CLI arg `--symlinks` as there is a bug through config file usage (`serve@11`).