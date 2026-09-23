---
name: reply-guy
description: Queue draft replies to relevant posts in the company voice. Nothing sends until the owner says so.
---
# Reply queue

This finds posts worth a comment and drafts the reply. It does not send.

The file is `/var/lib/plow/workspace/reply-guy.json`. Only the owner writes it, in the owner's conversation. If it is missing, ask once for accounts or search topics, a daily cap, and who never to reply to. Then write:

```json
{
  "targets": [],
  "queries": [],
  "dailyCap": 5,
  "blocklist": []
}
```

There is no X search in this image. The posts come from what the owner pasted, or from a company-watch mention that is actually in the fetch output. If neither exists, say the posts are missing and stop. Never invent a post, a handle, or a quote.

A draft runs in the marketing worker. Each item is the post, why it fits one pillar, the reply, and a risk if there is one. Stay at or under `dailyCap`. Skip the blocklist and the company-watch competitors. The reply adds one specific point. It does not praise, pile on, or argue with someone on the blocklist.

The same rules cover replies on the company's own posts and quote-posts. A quote-post adds one new idea. It does not repeat the original.

Read the content pillars and the channel voice before drafting. Apply the content-editor skill. Follow the marketing-delivery skill before anything is sent. With yolo off, a queue is not permission to post.
