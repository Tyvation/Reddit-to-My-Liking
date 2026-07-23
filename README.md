# Reddit to My Liking

> **Project status:** Not actively maintained. Feel free to fork it yourself.

A small extension for `chromium browsers` that opens Reddit posts and comment threads inside Reddit's right sidebar without navigating away from the feed.

- How it looks like:
![DEMO](demo.gif)

## Features

- Opens post and comment links in a reader beside the feed, without navigating away or losing the feed's scroll position.
- Uses the native Reddit post page and isolates its `#main-content`, preserving Reddit's comments, voting, replies, sorting, search, composer, media, and galleries.
- Replaces **Recent Posts** only while the reader is open. The reader is closed by default and restores the original sidebar when closed.
- Supports Full and Compact layouts. Their responsive widths can be adjusted from the extension toolbar popup.
- Adds an in-page image viewer to both the feed and inline reader, with wheel zoom, drag-to-pan, a blurred backdrop, and previous/next controls for galleries.
- Works on the Reddit homepage, subreddit feeds, global search, and subreddit search pages.
- Leaves Ctrl/Cmd-click, Shift-click, middle-click, and **Open normally** available for normal browser navigation.
- Contains no analytics or remotely hosted extension code.

## Install

1. Extract this folder.
2. Open `Manage Extensions` in browser.
3. Enable **Developer mode**.
4. Select **Load unpacked**.
5. Choose the `reddit-to-my-liking` folder.
6. Reload Reddit.

## Notes and limitations

- Only been tested on `Google Chrome` and `Helium` browser, no idea if this will work on any other browsers.
- Supports `www.reddit.com` only. Old Reddit and other Reddit hostnames are not supported.
- Designed for desktop layouts with enough horizontal space for the feed and reader. Very narrow windows may leave little usable reader space.
- The inline reader still loads Reddit's full page before isolating `#main-content`; loading speed and memory use therefore depend on Reddit.
- Reddit frequently changes its DOM and CSS. Click interception is URL-based, but page isolation, sidebar placement, and media handling may require future updates.
- Restricted, quarantined, private, deleted, or login-gated content may fail to load inline and require **Open normally**.
- Some external media hosts block embedding. Other image-viewer extensions can also conflict with the built-in viewer.
- This project is manually installed and not actively maintained. Updates require replacing the files and reloading the unpacked extension.
- This is an independent project and is not affiliated with Reddit.

## License

Licensed under the [MIT License](LICENSE).
