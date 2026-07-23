# Reddit to My Liking

> **Project status:** Not actively maintained. Feel free to fork it yourself.

A small Manifest V3 Chrome/Edge extension that opens Reddit posts and comment
threads inside Reddit's right sidebar without navigating away from the feed.

## Features

- Intercepts normal left-clicks on Reddit post/comment links.
- Runs only on the Reddit homepage and subreddit feed pages.
- Replaces the **Recent Posts** sidebar with an inline post reader; toggle restores it.
- Loads the native Reddit post page in a same-origin inline frame.
- Shows only Reddit's native `#main-content`; Reddit handles comments, voting, replies, media, and galleries.
- Keeps the feed and its scroll position intact.
- Ctrl/Cmd-click, Shift-click, middle-click, and “Open original” retain normal behavior.
- No remote code and no analytics.

## Install

1. Extract this folder.
2. Open `chrome://extensions` in Chrome or `edge://extensions` in Edge.
3. Enable **Developer mode**.
4. Select **Load unpacked**.
5. Choose the extracted `reddit-inline-pane` folder.
6. Reload Reddit.

## Notes and limitations

- Reddit changes its DOM frequently. The click interception is URL-based and should
  be more stable than selectors, but hiding the Recent Posts card may occasionally
  require selector updates.
- Restricted, quarantined, or login-gated posts may still require **Open original**.
- This is an independent local extension and is not affiliated with Reddit.

After editing, press the extension's **Reload** button on `chrome://extensions`.
