export type FeedEntry = {
  title: string;
  url: string;
  description: string;
};

export type FeedCategory = {
  id: string;
  label: string;
  icon: string;
  feeds: FeedEntry[];
};

export const FEED_DIRECTORY: FeedCategory[] = [
  {
    id: "tech",
    label: "Technology",
    icon: "💻",
    feeds: [
      { title: "The Verge", url: "https://www.theverge.com/rss/index.xml", description: "Tech, science, art, and culture" },
      { title: "Ars Technica", url: "https://feeds.arstechnica.com/arstechnica/index", description: "In-depth technology news and analysis" },
      { title: "Wired", url: "https://www.wired.com/feed/rss", description: "Technology, culture, and ideas shaping our world" },
      { title: "TechCrunch", url: "https://techcrunch.com/feed/", description: "Startup and technology news" },
      { title: "Hacker News", url: "https://hnrss.org/frontpage", description: "Top stories from the Hacker News community" },
      { title: "MIT Technology Review", url: "https://www.technologyreview.com/feed/", description: "Emerging technology in context" },
      { title: "The Register", url: "https://www.theregister.com/headlines.atom", description: "Enterprise technology news with attitude" },
    ],
  },
  {
    id: "ai",
    label: "AI & Machine Learning",
    icon: "🤖",
    feeds: [
      { title: "MIT AI News", url: "https://www.technologyreview.com/topic/artificial-intelligence/feed", description: "AI coverage from MIT Tech Review" },
      { title: "Google DeepMind Blog", url: "https://deepmind.google/blog/rss.xml", description: "Research and breakthroughs from DeepMind" },
      { title: "Hugging Face Blog", url: "https://huggingface.co/blog/feed.xml", description: "Open-source AI models and tools" },
      { title: "Papers With Code", url: "https://paperswithcode.com/latest.rss", description: "Latest ML papers with code implementations" },
      { title: "The Gradient", url: "https://thegradient.pub/rss/", description: "Perspectives on AI research" },
      { title: "Import AI", url: "https://jack-clark.net/feed/", description: "Weekly AI news digest by Jack Clark" },
    ],
  },
  {
    id: "science",
    label: "Science & Space",
    icon: "🔭",
    feeds: [
      { title: "NASA", url: "https://www.nasa.gov/feed/", description: "Space exploration and discovery" },
      { title: "Nature News", url: "https://www.nature.com/news.rss", description: "World-leading science journal" },
      { title: "Science Daily", url: "https://www.sciencedaily.com/rss/all.xml", description: "Breaking science news from top universities" },
      { title: "New Scientist", url: "https://www.newscientist.com/feed/home/", description: "Science and technology for the curious" },
      { title: "Space.com", url: "https://www.space.com/feeds/all", description: "Space exploration, astronomy, and physics" },
      { title: "Phys.org", url: "https://phys.org/rss-feed/", description: "Daily physics and science news" },
      { title: "Quanta Magazine", url: "https://www.quantamagazine.org/feed/", description: "Math, physics, biology, and computer science" },
    ],
  },
  {
    id: "finance",
    label: "Finance & Economics",
    icon: "📈",
    feeds: [
      { title: "Bloomberg Markets", url: "https://feeds.bloomberg.com/markets/news.rss", description: "Global markets and financial news" },
      { title: "The Economist", url: "https://www.economist.com/latest/rss.xml", description: "Authoritative analysis of world events" },
      { title: "Financial Times", url: "https://www.ft.com/?format=rss", description: "Global financial news and analysis" },
      { title: "Reuters Business", url: "https://feeds.reuters.com/reuters/businessNews", description: "Business and finance news wire" },
      { title: "WSJ Markets", url: "https://feeds.a.dj.com/rss/RSSMarketsMain.xml", description: "Wall Street Journal markets coverage" },
      { title: "Marginal Revolution", url: "https://feeds.feedburner.com/marginalrevolution/feed", description: "Economics blog by Tyler Cowen" },
    ],
  },
  {
    id: "world",
    label: "World News",
    icon: "🌍",
    feeds: [
      { title: "BBC World", url: "http://feeds.bbci.co.uk/news/world/rss.xml", description: "World news from the BBC" },
      { title: "Reuters World", url: "https://feeds.reuters.com/Reuters/worldNews", description: "Global news from Reuters wire" },
      { title: "Al Jazeera", url: "https://www.aljazeera.com/xml/rss/all.xml", description: "News from a global perspective" },
      { title: "The Guardian World", url: "https://www.theguardian.com/world/rss", description: "International news and analysis" },
      { title: "NPR News", url: "https://feeds.npr.org/1001/rss.xml", description: "U.S. public radio news coverage" },
      { title: "AP Top News", url: "https://rsshub.app/apnews/topics/apf-topnews", description: "Associated Press top stories" },
    ],
  },
  {
    id: "singapore",
    label: "Singapore",
    icon: "🇸🇬",
    feeds: [
      { title: "CNA", url: "https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml", description: "Channel News Asia — top stories" },
      { title: "The Straits Times", url: "https://www.straitstimes.com/news/singapore/rss.xml", description: "Singapore's newspaper of record" },
      { title: "Today Online", url: "https://www.todayonline.com/rss/singapore", description: "Singapore news and analysis" },
      { title: "Business Times SG", url: "https://www.businesstimes.com.sg/rss/all", description: "Singapore and Asia business news" },
      { title: "Mothership SG", url: "https://mothership.sg/feed/", description: "Singapore news for the digital generation" },
    ],
  },
  {
    id: "cybersecurity",
    label: "Cybersecurity",
    icon: "🔐",
    feeds: [
      { title: "Krebs on Security", url: "https://krebsonsecurity.com/feed/", description: "In-depth security news by Brian Krebs" },
      { title: "The Hacker News", url: "https://feeds.feedburner.com/TheHackersNews", description: "Cybersecurity news and vulnerability alerts" },
      { title: "Bleeping Computer", url: "https://www.bleepingcomputer.com/feed/", description: "Security news and technology help" },
      { title: "Dark Reading", url: "https://www.darkreading.com/rss.xml", description: "Enterprise security intelligence" },
      { title: "SANS Internet Stormcast", url: "https://isc.sans.edu/rssfeed_full.xml", description: "Daily threat intelligence briefings" },
      { title: "Schneier on Security", url: "https://www.schneier.com/feed/atom/", description: "Security essays by Bruce Schneier" },
    ],
  },
  {
    id: "defense",
    label: "Defense & Geopolitics",
    icon: "🛡️",
    feeds: [
      { title: "Defense News", url: "https://www.defensenews.com/arc/outboundfeeds/rss/", description: "Defense industry and military news" },
      { title: "War on the Rocks", url: "https://warontherocks.com/feed/", description: "National security strategy and analysis" },
      { title: "Foreign Policy", url: "https://foreignpolicy.com/feed/", description: "Geopolitics and international affairs" },
      { title: "The Diplomat", url: "https://thediplomat.com/feed/", description: "Asia-Pacific politics and security" },
      { title: "Bellingcat", url: "https://www.bellingcat.com/feed/", description: "Open-source investigations" },
      { title: "RAND Blog", url: "https://www.rand.org/blog.xml", description: "Policy research and analysis" },
    ],
  },
  {
    id: "data",
    label: "Data & Analytics",
    icon: "📊",
    feeds: [
      { title: "FiveThirtyEight", url: "https://fivethirtyeight.com/features/feed/", description: "Data-driven journalism on politics and sports" },
      { title: "Towards Data Science", url: "https://towardsdatascience.com/feed", description: "Data science tutorials and articles" },
      { title: "Flowing Data", url: "https://flowingdata.com/feed", description: "Data visualization and statistics" },
      { title: "Pudding", url: "https://pudding.cool/feed/index.xml", description: "Visual essays on culture and data" },
    ],
  },
  {
    id: "design_dev",
    label: "Design & Development",
    icon: "🎨",
    feeds: [
      { title: "Smashing Magazine", url: "https://www.smashingmagazine.com/feed/", description: "Web design and front-end development" },
      { title: "CSS-Tricks", url: "https://css-tricks.com/feed/", description: "CSS, HTML, and web dev tips" },
      { title: "A List Apart", url: "https://alistapart.com/main/feed/", description: "Web standards, design, and development" },
      { title: "UX Collective", url: "https://uxdesign.cc/feed", description: "UX design articles and insights" },
    ],
  },
];
