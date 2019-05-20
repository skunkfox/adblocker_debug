/*!
 * Copyright (c) 2017-2019 Cliqz GmbH. All rights reserved.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

/* eslint-disable no-await-in-loop */

const fs = require('fs');
const createPuppeteerPool = require('puppeteer-pool');
const stream = require('stream');
const { getDomain } = require('tldts');

class RequestStreamer extends stream.Readable {
  constructor(options) {
    super(options);

    this.totalRequests = 0;
  }

  onRequest(request) {
    this.totalRequests += 1;
    this.push(`${JSON.stringify(request)}\n`);
  }

  tearDown() {
    // Terminate stream
    try {
      this.push(null);
    } catch (ex) {
      /* Ignore */
    }
  }

  _read() {
    /* Do nothing? */
  }
}

let CURRENT_ID = 0;
function getNextId() {
  const id = CURRENT_ID;
  CURRENT_ID += 1;
  return id;
}

async function collectDataset(domains) {
  // Stream requests to file
  const requestStream = new RequestStreamer();
  const outputStream = fs.createWriteStream('requests2.json');
  requestStream.pipe(outputStream);

  const visitUrl = async (browser, { domainId, url, domain }) => {
    const pageId = getNextId();
    // Stream all requests to output file through `requestStream`
    const onRequest = (request) => {
      // Ignore data-urls
      const requestUrl = request.url();
      if (
        !(
          requestUrl.startsWith('https://')
          || requestUrl.startsWith('http://')
          || requestUrl.startsWith('ws://')
          || requestUrl.startsWith('wss://')
        )
      ) {
        return;
      }

      requestStream.onRequest({
        domainId,
        pageId,
        frameUrl: request.resourceType() === 'document' ? request.url() : request.frame().url(),
        url: requestUrl,
        cpt: request.resourceType(),
      });
    };

    // Whenever `url` is not specified (when we want to visit the home page of a
    // domain), then we try several candidates (https/http).
    const candidates = [
      url,
      `https://www.${domain}`,
      `https://${domain}`,
      `http://www.${domain}`,
      `http://${domain}`,
    ];

    for (let i = 0; i < candidates.length; i += 1) {
      const urlToVisit = candidates[i];

      if (urlToVisit) {
        const page = await browser.newPage();
        try {
          // Collect all requests used to load the page
          page.on('request', onRequest);

          console.log(`  * goto: ${urlToVisit}`);
          const status = await page.goto(urlToVisit, {
            timeout: 120000,
            waitUntil: 'networkidle2',
          });

          const pageUrl = page.url();
          if (pageUrl !== urlToVisit) {
            console.log(`    > ${page.url()}`);
          }

          // We do not collect URLs unless we are on the home-page
          if (status.ok && url === undefined) {
            const domainOfPage = getDomain(pageUrl);
            const urlsOnPage = await page.evaluate(() => [...document.querySelectorAll('a')].map(a => a.href).filter(Boolean));
            const sameDomainUrls = urlsOnPage.filter(
              href => href
                && (href.startsWith('https://')
                  || href.startsWith('http://')
                  || href.startsWith('ws://')
                  || href.startsWith('wss://'))
                && getDomain(href) === domainOfPage,
            );
            return [...new Set(sameDomainUrls)];
          }
        } catch (ex) {
          console.log(`Could not fetch: ${urlToVisit}`, ex);
        } finally {
          await page.removeAllListeners('request');
          await page.close();
        }
      }

      // If `url` was specified, we do not proceed with visiting other
      // candidates based on `domain`.
      if (url !== undefined) {
        return [];
      }
    }

    return [];
  };

  const processDomain = async (browser, domain, index) => {
    const domainId = getNextId();
    try {
      // Visit home page of domain
      console.log(`Home page: ${domain} (${index})`);
      const linksOnPage = await visitUrl(browser, { domainId, domain });

      // Visit 3 random URLs from the page
      if (linksOnPage.length > 0) {
        for (let j = 0; j < Math.min(3, linksOnPage.length); j += 1) {
          await visitUrl(browser, {
            domain,
            domainId,
            url: linksOnPage[Math.floor(Math.random() * linksOnPage.length)],
          });
        }
      } else {
        return false;
      }

      console.log(`Finished processing: ${domain}, total: ${requestStream.totalRequests} reqs`);
      return true;
    } catch (ex) {
      console.error(`Error while processing: ${domain}`, ex);
      return false;
    }
  };

  // Create pool of browsers
  const pool = createPuppeteerPool({
    max: 6,
    maxUses: 5,
  });

  let numberOfDomainsProcessed = 0;
  domains.forEach((domain, i) => {
    pool.use(async (browser) => {
      if (numberOfDomainsProcessed >= 500) {
        return;
      }

      const success = await processDomain(browser, domain, i);
      if (success) {
        numberOfDomainsProcessed += 1;
      }
    });
  });

  await pool.drain();
  await pool.clear();
  requestStream.tearDown();
}

collectDataset([
  'wikipedia.org',
  'amazon.com',
  'reddit.com',
  'xvideos.com',
  'imdb.com',
  'google.com',
  'wikia.com',
  'youtube.com',
  'stackoverflow.com',
  'amazon.de',
  'spiegel.de',
  'github.com',
  'theguardian.com',
  'mail.ru',
  'bbc.co.uk',
  'facebook.com',
  'pornhub.com',
  'microsoft.com',
  'xhamster.com',
  'chaturbate.com',
  'ikea.com',
  'nytimes.com',
  'apple.com',
  'twitter.com',
  'voirfilms.ws',
  'cnn.com',
  'bbc.com',
  'foxnews.com',
  'yandex.ru',
  'imgur.com',
  'gamepedia.com',
  'aliexpress.com',
  'dailymail.co.uk',
  'blogspot.com',
  'rambler.ru',
  'heise.de',
  't-online.de',
  'zone-telechargement1.com',
  'leboncoin.fr',
  'nexusmods.com',
  'amazon.fr',
  'w3schools.com',
  'adobe.com',
  'xnxx.com',
  'tumblr.com',
  '4chan.org',
  'yahoo.com',
  'ebay.com',
  'lequipe.fr',
  'paypal.com',
  'mozilla.org',
  'yaplakal.com',
  'steampowered.com',
  'vseigru.net',
  'nu.nl',
  'amazon.co.uk',
  'twitch.tv',
  'craigslist.org',
  'lenta.ru',
  'wordpress.com',
  'stackexchange.com',
  'instagram.com',
  'coinmarketcap.com',
  'allocine.fr',
  'chip.de',
  'joemonster.org',
  'rt.com',
  'youporn.com',
  'yts.am',
  'nhentai.net',
  'thepiratebay.org',
  'bs.to',
  'booking.com',
  'web.de',
  'bild.de',
  'zeit.de',
  'crunchyroll.com',
  'ebay.de',
  'sourceforge.net',
  'tagesschau.de',
  'onet.pl',
  'zdf.de',
  'office.com',
  'orange.fr',
  'espn.com',
  'gearbest.com',
  'avito.ru',
  'nos.nl',
  'arstechnica.com',
  'myanimelist.net',
  'redtube.com',
  'focus.de',
  'quora.com',
  'sueddeutsche.de',
  'wykop.pl',
  'zerohedge.com',
  'github.io',
  'google.fr',
  'icy-veins.com',
  'breitbart.com',
  'google.de',
  'globo.com',
  'thesaurus.com',
  'rottentomatoes.com',
  'faz.net',
  'deviantart.com',
  'fextralife.com',
  'humblebundle.com',
  'yahoo.co.jp',
  'wp.pl',
  'orf.at',
  'thesimsresource.com',
  'free.fr',
  'jeuxvideo.com',
  'francetvinfo.fr',
  '1337x.to',
  'ghostery.com',
  'programme-tv.net',
  'abc.net.au',
  'n-tv.de',
  'businessinsider.com',
  'torrent9.red',
  'independent.co.uk',
  'bloomberg.com',
  'yourporn.sexy',
  'xda-developers.com',
  'ccleaner.com',
  'ebay-kleinanzeigen.de',
  'wowhead.com',
  'dict.cc',
  'mangakakalot.com',
  'xkcd.com',
  'interia.pl',
  'worldlifestyle.com',
  'ycombinator.com',
  'livejournal.com',
  'samsung.com',
  'seasonvar.ru',
  'medium.com',
  'tripadvisor.com',
  'streamcomplet.me',
  'hm.com',
  'e-hentai.org',
  'politico.com',
  'lesnumeriques.com',
  '01net.com',
  'whatsapp.com',
  'repubblica.it',
  'cnbc.com',
  'thehill.com',
  'spotify.com',
  'wuxiaworld.com',
  'gizmodo.com',
  'computerbild.de',
  'oracle.com',
  'f95zone.com',
  'softonic.com',
  'amazon.in',
  'novinky.cz',
  'curseforge.com',
  'speedtest.net',
  'battle.net',
  'techradar.com',
  'e621.net',
  'askubuntu.com',
  'hurriyet.com.tr',
  'spankbang.com',
  'linkedin.com',
  'nih.gov',
  'gsmarena.com',
  'ivi.ru',
  'nypost.com',
  'dr.dk',
  'wordreference.com',
  'howtogeek.com',
  'pole-emploi.fr',
  'fishki.net',
  'telegraph.co.uk',
  'ebay.co.uk',
  'newegg.com',
  'python.org',
  'ouest-france.fr',
  'pornpics.com',
  'uol.com.br',
  'yggtorrent.com',
  'intel.com',
  'msn.com',
  'definition.org',
  'chase.com',
  'hdrezka.ag',
  'lidl.de',
  'allegro.pl',
  'fanfox.net',
  'walmart.com',
  'amazon.ca',
  'wildberries.ru',
  'lemonde.fr',
  'yelp.com',
  'dropbox.com',
  'wikihow.com',
  'ekstrabladet.dk',
  'historyinorbit.com',
  'stardewvalleywiki.com',
  'dell.com',
  'theatlantic.com',
  'poe.trade',
  'asus.com',
  'hp.com',
  'dwatchseries.to',
  'impots.gouv.fr',
  'accuweather.com',
  'mobafire.com',
  'go.com',
  'service-public.fr',
  'clubic.com',
  'goodreads.com',
  'amazon.it',
  'linternaute.com',
  'gocomics.com',
  'adme.ru',
  'bestbuy.com',
  'gamespot.com',
  'msk.ru',
  'koreus.com',
  'netflix.com',
  'bt.dk',
  'pathofexile.com',
  'pcgamer.com',
  'tf1.fr',
  'wetter.com',
  'smbc-comics.com',
  'huffingtonpost.fr',
  'genius.com',
  'asos.com',
  'france.tv',
  'wsj.com',
  'stern.de',
  'wordpress.org',
  'filehippo.com',
  'lefigaro.fr',
  'animeflv.net',
  'thechive.com',
  'pinterest.com',
  'onlinevideoconverter.com',
  'nbcnews.com',
  'ign.com',
  'express.co.uk',
  'weather.com',
  'bandcamp.com',
  'steamcommunity.com',
  'bilibili.com',
  'op.gg',
  'decathlon.fr',
  'bahn.de',
  'nyaa.si',
  'getbootstrap.com',
  'costco.com',
  'roblox.com',
  'igg-games.com',
  'liveleak.com',
  'skype.com',
  'cbc.ca',
  'emuparadise.me',
  'etsy.com',
  'indeed.com',
  'tukif.com',
  'kicker.de',
  'boredpanda.com',
  'oglaf.com',
  'pagesjaunes.fr',
  'cbsnews.com',
  'gamestar.de',
  'php.net',
  'lowes.com',
  'engadget.com',
  'cnet.com',
  'epicgames.com',
  'fc2.com',
  'salesforce.com',
  'footmercato.net',
  'commentcamarche.net',
  'mangareader.net',
  'ubuntu.com',
  'filmweb.pl',
  'libertyvf.com',
  'theregister.co.uk',
  'lifehacker.com',
  'udemy.com',
  'guildwars2.com',
  'android.com',
  'champion.gg',
  'championat.com',
  'superuser.com',
  '8muses.com',
  'willhaben.at',
  'lifewire.com',
  'nouvelobs.com',
  'intuit.com',
  'transfermarkt.de',
  'thingiverse.com',
  'skidrowreloaded.com',
  'yggtorrent.is',
  'eurosport.fr',
  'ups.com',
  'gismeteo.ru',
  'tutorialspoint.com',
  'gog.com',
  'cdiscount.com',
  'readms.net',
  'bleacherreport.com',
  'arte.tv',
  'nicovideo.jp',
  'bulbagarden.net',
  'homedepot.com',
  'mvideo.ru',
  'rawstory.com',
  'gmx.net',
  'trend-chaser.com',
  'oui.sncf',
  'blick.ch',
  'porno365.xxx',
  'kotaku.com',
  'ldlc.com',
  'slate.com',
  '9gag.com',
  'wargaming.net',
  'usps.com',
  'probuilds.net',
  'bankofamerica.com',
  'krone.at',
  'torrent9.bz',
  'tvn24.pl',
  'duckduckgo.com',
  'hltv.org',
  'gosuslugi.ru',
  'sportschau.de',
  'videolan.org',
  'knowyourmeme.com',
  'xfinity.com',
  'idealo.de',
  'google.ru',
  'dailymotion.com',
  'super.cz',
  'canada.ca',
  'dailycaller.com',
  'fnac.com',
  'lostfilm.tv',
  'txxx.com',
  'resetera.com',
  'nike.com',
  'jetbrains.com',
  'nvidia.com',
  'bfmtv.com',
  'cda.pl',
  'tut.by',
  'amazon.es',
  'olx.pl',
  'ultimate-guitar.com',
  'habrahabr.ru',
  'dns-shop.ru',
  'thomann.de',
  'amazon.co.jp',
  'washingtonpost.com',
  'sankakucomplex.com',
  'lelscanv.com',
  'kwejk.pl',
  'marketwatch.com',
  'ameli.fr',
  'loverslab.com',
  'techcrunch.com',
  'leroymerlin.fr',
  'verizonwireless.com',
  'daserste.de',
  'rutor.info',
  'liquipedia.net',
  'vporn.com',
  'patreon.com',
  'hulu.com',
  'thesun.co.uk',
  'sme.sk',
  'impress.co.jp',
  'cisco.com',
  'kino-hd1080.ru',
  'wetransfer.com',
  'kickstarter.com',
  'citilink.ru',
  'computerbase.de',
  'movie-blog.org',
  'liberation.fr',
  'mk.ru',
  'meduza.io',
  'mobile.de',
  'wellsfargo.com',
  'mydealz.de',
  'irs.gov',
  'leagueoflegends.com',
  'infobae.com',
  'reverso.net',
  'lenovo.com',
  'slickdeals.net',
  'raspberrypi.org',
  'vimeo.com',
  'expressen.se',
  'glassdoor.com',
  'ashemaletube.com',
  'digitalocean.com',
  'dagbladet.no',
  'discordapp.com',
  'worldoftanks.ru',
  'ssa.gov',
  'laposte.fr',
  '20min.ch',
  'npmjs.com',
  'ixxx.com',
  'onliner.by',
  'apache.org',
  'google.co.uk',
  'explosm.net',
  'cracked.com',
  'baidu.com',
  'vesti.ru',
  'wayfair.com',
  'animevost.org',
  'ledauphine.com',
  'libertyvf.net',
  'livedoor.jp',
  'dealabs.com',
  'europa.eu',
  'uniqlo.com',
  'hln.be',
  'urbandictionary.com',
  'newyorker.com',
  'hitomi.la',
  'makeuseof.com',
  'zone-telechargement1.org',
  'mirror.co.uk',
  'streamable.com',
  'tomsguide.com',
  'cb01.zone',
  'xe.com',
  'fivethirtyeight.com',
  'ants.gouv.fr',
  'french-stream.co',
  'usatoday.com',
  'dmm.co.jp',
  'dhl.de',
  'tripadvisor.fr',
  'deadspin.com',
  'wunderground.com',
  'united.com',
  'vodafone.de',
  'visualstudio.com',
  'extreme-down.im',
  'tube8.com',
  '444.hu',
  'csfd.cz',
  'kinox.to',
  'pcwelt.de',
  'boingboing.net',
  'habr.com',
  'pudelek.pl',
  'cbssports.com',
  'archlinux.org',
  'drudgereport.com',
  'torrent9.blue',
  'shadbase.com',
  'libreoffice.org',
  'readthedocs.io',
  'wired.com',
  'live.com',
  'people.com',
  'hearthpwn.com',
  'motherless.com',
  'labanquepostale.fr',
  'dafont.com',
  'ca.gov',
  'digitaltrends.com',
  'sky.de',
  'att.com',
  'indiatimes.com',
  'jalopnik.com',
  'darty.com',
  'thewirecutter.com',
  'instant-gaming.com',
  'sportbox.ru',
  'usnews.com',
  'lifehacker.ru',
  'arduino.cc',
  'allrecipes.com',
  'time.com',
  'gogoanime.se',
  'kinokrad.co',
  '123movieshub.to',
  'mi.com',
  'hubspot.com',
  'marmiton.org',
  'zillow.com',
  'bouyguestelecom.fr',
  'playstation.com',
  's.to',
  'ebay.fr',
  'cinecalidad.to',
  'telekom.de',
  'd20pfsrd.com',
  'nrk.no',
  'duden.de',
  'pcgames-download.com',
  'index.hu',
  'tagesspiegel.de',
  'extreme-d0wn.com',
  'tubegalore.com',
  'thedailybeast.com',
  'timeanddate.com',
  'doramatv.ru',
  'wetteronline.de',
  'aldi-sued.de',
  'teamviewer.com',
  'consumerreports.org',
  'sfr.fr',
  'corriere.it',
  'majorgeeks.com',
  'ing.nl',
  'imagefap.com',
  'index.hr',
  'webtoons.com',
  'hentaihaven.org',
  'latimes.com',
  'kiwireport.com',
  'masterani.me',
  'google.nl',
  'funnyjunk.com',
  'tomshardware.com',
  'garmin.com',
  'furaffinity.net',
  'digg.com',
  'joyreactor.cc',
  'mlb.com',
  'dailywire.com',
  'meteofrance.com',
  'logitech.com',
  'pexels.com',
  'americanexpress.com',
  'dkb.de',
  'banggood.com',
  'gidonline.in',
  'sims3pack.ru',
  'cheezburger.com',
  '20minutes.fr',
  'opera.com',
  'ar15.com',
  'viki.com',
  'isnichwahr.de',
  'vpornoonlain.tv',
  'amd.com',
  'wiktionary.org',
  'linuxmint.com',
  'belastingdienst.nl',
  'google.pl',
  'stoloto.ru',
  'mailchimp.com',
  'delta.com',
  'coursera.org',
  'onlinesbi.com',
  'groupon.com',
  'expedia.com',
  'youjizz.com',
  'buienradar.nl',
  'tvtropes.org',
  '90skidsonly.com',
  'giga.de',
  'discogs.com',
  'atlassian.com',
  'leroymerlin.ru',
  'frandroid.com',
  'ceneo.pl',
  'unity3d.com',
  'wetter.de',
  'ilfattoquotidiano.it',
  'livescore.com',
  'google.ca',
  'uptodown.com',
  'syosetu.com',
  'xbox.com',
  'korrespondent.net',
  'commentcamarche.com',
  'archive.org',
  'thefappeningblog.com',
  'lastpass.com',
  'instructables.com',
  'pcpartpicker.com',
  'wizards.com',
  'mangahere.cc',
  'journaldesfemmes.com',
  'conforama.fr',
  'dictionary.com',
  'wdr.de',
  'airbnb.com',
  'finanzen.net',
  'bing.com',
  'onedio.ru',
  'subscene.com',
  'lachainemeteo.com',
  'jbzdy.pl',
  'goldesel.to',
  'ok.ru',
  'boursorama.com',
  'cheatsheet.com',
  'idnes.cz',
  'watchcartoononline.com',
  'rei.com',
  'fitgirl-repacks.site',
  'olx.ua',
  'utorrent.com',
  'sport1.de',
  'taringa.net',
  'webmd.com',
  'sephora.com',
  'docker.com',
  'pcworld.com',
  'trello.com',
  'nrc.nl',
  'evernote.com',
  'eroprofile.com',
  'mercadolivre.com.br',
  'plex.tv',
  'vice.com',
  'literotica.com',
  'worldofwarcraft.com',
  'avm.de',
  'emojipedia.org',
  'golem.de',
  'zalando.de',
  'shopify.com',
  'infowars.com',
  'postbank.de',
  'debian.org',
  'cont.ws',
  'senscritique.com',
  'jquery.com',
  'gala.fr',
  'vrt.be',
  'ebaumsworld.com',
  'milliyet.com.tr',
  'altadefinizione.pink',
  'materiel.net',
  'geektimes.ru',
  'papstream.net',
  'snopes.com',
  'nintendo.com',
  'blizzard.com',
  'urbanoutfitters.com',
  'slideshare.net',
  'themeforest.net',
  'target.com',
  'lamoda.ru',
  'watchcartoononline.io',
  'spiceworks.com',
  'css-tricks.com',
  'mmo-champion.com',
  'bricodepot.fr',
  'tv2.dk',
  'origo.hu',
  'mindfactory.de',
  'downloadhelper.net',
  'chefkoch.de',
  'metacritic.com',
  'boulanger.com',
  'otto.de',
  'freepik.com',
  'git-scm.com',
  'dpstream.net',
  'hclips.com',
  'autodesk.com',
  'kijiji.ca',
  'microsoftonline.com',
  'weebly.com',
  'lexpress.fr',
  'imgsrc.ru',
  'malwarebytes.com',
  'androidcentral.com',
  'bhphotovideo.com',
  'sky.com',
  'talkingpointsmemo.com',
  'bitcointalk.org',
  'sncf.com',
  '24.hu',
  'elconfidencial.com',
  'urssaf.fr',
  'castorama.fr',
  'sozcu.com.tr',
  'google.it',
  'iflscience.com',
  'journaldugeek.com',
  'nydailynews.com',
  'onepiece-tube.com',
  'deutschepost.de',
  'mayoclinic.org',
  'flaticon.com',
  'sports.ru',
  'huffingtonpost.com',
  'healthline.com',
  'warframe.com',
  'aol.com',
  'mts.ru',
  'ebay.com.au',
  'doctissimo.fr',
  'soundcloud.com',
  'zoom.us',
  'nordstrom.com',
  'windowscentral.com',
  'niezalezna.pl',
  'caf.fr',
  'ndtv.com',
  'coinbase.com',
  'nymag.com',
  'bol.com',
  'mangafox.la',
  'game-game.com.ua',
  'delfi.lt',
  'netzwelt.de',
  'flvto.biz',
  'immobilienscout24.de',
  'theweathernetwork.com',
  'elastic.co',
  'vmware.com',
  'delfi.ee',
  'convert2mp3.net',
  'eurogamer.net',
  'vg.no',
  'rockpapershotgun.com',
  'solarmoviez.ru',
  'moddb.com',
  'playground.ru',
  'topachat.com',
  '4pda.ru',
  'ddl.me',
  'geforce.com',
  'thebalance.com',
  'mysql.com',
  'pornhd.com',
  'douyu.com',
  'macys.com',
  'teleprogramma.pro',
  'google.es',
  'voici.fr',
  'topito.com',
  'over-blog.com',
  'buzzfeed.com',
  'marca.com',
  'express.de',
  'distrowatch.com',
  'tesla.com',
  'boardgamegeek.com',
  'igroutka.net',
  'vulture.com',
  'smallpdf.com',
  'ted.com',
  'serverfault.com',
  'qq.com',
  'zaycev.net',
  'mangadex.org',
  'nasa.gov',
  'dpreview.com',
  'egaliteetreconciliation.fr',
  'ibm.com',
  'thegatewaypundit.com',
  'animeyt.tv',
  'meneame.net',
  'metro.co.uk',
  'ubnt.com',
  'mit.edu',
  'autooverload.com',
  'torrent9.ec',
  'avclub.com',
  'macrumors.com',
  'vnexpress.net',
  'google.co.in',
  'hornbach.de',
  'millenium.org',
  'openclassrooms.com',
  'maximonline.ru',
  'qz.com',
  'yle.fi',
  'shooshtime.com',
  'zdnet.com',
  'jutarnji.hr',
  'fifa.com',
  'gutefrage.net',
  '3dnews.ru',
  'quechoisir.org',
  'wiocha.pl',
  'gigazine.net',
  'postimees.ee',
  'creditmutuel.fr',
  'bodybuilding.com',
  'gitlab.com',
  'smh.com.au',
  'aa.com',
  'walgreens.com',
  'canva.com',
  'si.com',
  'easyjet.com',
  'medialeaks.ru',
  'java.com',
  'rlsbb.ru',
  'worldation.com',
  'npo.nl',
  'hollywoodreporter.com',
  'eporner.com',
  'societegenerale.fr',
  'researchgate.net',
  'mediamarkt.de',
  'serienstream.to',
  'sportmaster.ru',
  '1und1.de',
  'himado.in',
  'kayak.com',
  'efukt.com',
  'edf.fr',
  'msi.com',
  'tnt-online.ru',
  'topwar.ru',
  'heavy-r.com',
  'animedigitalnetwork.fr',
  'godaddy.com',
  'audible.com',
  'anidub.com',
  'zara.com',
  'travelfuntu.com',
  'google.com.br',
  'alternate.de',
  'ardmediathek.de',
  'slack.com',
  'anandtech.com',
  'coolmath-games.com',
  'svscomics.com',
  'kurir.rs',
  'nbcsports.com',
  'javtorrent.re',
  'ipko.pl',
  'cplusplus.com',
  'tripadvisor.co.uk',
  'state.gov',
  'gry-online.pl',
  'ubuntu-fr.org',
  'edx.org',
  'caisse-epargne.fr',
  'citi.com',
  'vanguard.com',
  'zendesk.com',
  'woot.com',
  'benchmark.pl',
  'nalog.ru',
  'gfycat.com',
  'ifixit.com',
  'tass.ru',
  'pcastuces.com',
  'tmz.com',
  'xataka.com',
  'ndr.de',
  'torrent9.ru',
  'sdamgia.ru',
  'telegraaf.nl',
  'rueducommerce.fr',
  'ard.de',
  'mopo.de',
  'funda.nl',
  'kp.ru',
  'eztv.ag',
  'obozrevatel.com',
  'mediapart.fr',
  'aldi-nord.de',
  'fidelity.com',
  'geeksforgeeks.org',
  'protonmail.com',
  'surveymonkey.com',
  'fakt.pl',
  'cas.sk',
  'lg.com',
  'pomponik.pl',
  'investing.com',
  'celebjihad.com',
  'national-lottery.co.uk',
  'elster.de',
  'otakustream.tv',
  'freecodecamp.org',
  'gazzetta.it',
  'tripadvisor.de',
  'cyberciti.biz',
  'cbslocal.com',
  'togetter.com',
  'telerama.fr',
  'dlsite.com',
  'ozbargain.com.au',
  'thestar.com',
  'misspennystocks.com',
  'chron.com',
  'rarbg.to',
  'winfuture.de',
  'gta5-mods.com',
  'slate.fr',
  'pi-news.net',
  'clien.net',
  'aftershock.news',
  'europe1.fr',
  'obi.de',
  'sberbank.ru',
  'e1.ru',
  'eksisozluk.com',
  'economist.com',
  'novelupdates.com',
  'unity.com',
  'pagesix.com',
  'itv.com',
  'easeus.com',
  'cosmo.ru',
  'caradisiac.com',
  'tradingview.com',
  'journaldesfemmes.fr',
  'planet-streaming.com',
  'americanthinker.com',
  'xing.com',
  'xtube.com',
  'rtbf.be',
  'boredomtherapy.com',
  'hotcleaner.com',
  'sofoot.com',
  'perfectgirls.net',
  'papystreaming.com',
  'paradoxwikis.com',
  'tvmuse.com',
  'aktuality.sk',
  'mbank.pl',
  'nhl.com',
  'gamepress.gg',
  'google.co.jp',
  'marriott.com',
  'alibaba.com',
  'livestrong.com',
  'rakuten.co.jp',
  'abcya.com',
  'blic.rs',
  'rouming.cz',
  'leprogres.fr',
  'hpjav.com',
  'tomtom.com',
  'giantitp.com',
  'retailmenot.com',
  'glaz.tv',
  'gamestorrent.co',
  'realtor.com',
  'tvp.pl',
  'auto.ru',
  'crazyshit.com',
  'creditkarma.com',
  'asos.fr',
  'mejortorrent.com',
  'jimdo.com',
  'modthesims.info',
  'letribunaldunet.fr',
  'hqporner.com',
  'foodnetwork.com',
  'c-and-a.com',
  'fmovies.se',
  'guru3d.com',
  '16personalities.com',
  'sfgate.com',
  'seznamzpravy.cz',
  'americanupbeat.com',
  'starhit.ru',
  'life.ru',
  'pitchfork.com',
  'purepeople.com',
  'digitec.ch',
  '4tube.com',
  'sapo.pt',
  'pydata.org',
  'y8.com',
  'hearthstonetopdecks.com',
  'larousse.fr',
  'ren.tv',
  'jw.org',
  'lacentrale.fr',
  'scp-wiki.net',
  'primewire.ag',
  'scribd.com',
  'jezebel.com',
  'esuteru.com',
  'penny-arcade.com',
  'b9good.com',
  'seriouseats.com',
  'midilibre.fr',
  'wondershare.com',
  't-mobile.com',
  'nordvpn.com',
  'ea.com',
]);
