import { useEffect, useState } from 'react';
import { Channel } from './types';

export default function useChannel(channelId: string) {
  const [channel, setChannel] = useState<Channel>(undefined);

  useEffect(() => {
    void (async () => {
      await fetch(
        // Use proxy API backend
        `https://api.chzzk.naver.com.proxy.aioo.ooo/service/v1/channels/${channelId}`,
      )
        .then(
          (response) =>
            response.json() as Promise<{
              code: number;
              content: Channel;
            }>,
        )
        .then((data) => {
          if (data['code'] === 200) {
            setChannel(data['content']);
          }
        });
    })();
  }, [channelId]);

  return { channel };
}
