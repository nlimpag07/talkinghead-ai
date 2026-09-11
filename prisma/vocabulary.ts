/**
 * Tagalog and Bisaya (Cebuano) vocabulary, folded into the persona prompt so
 * the assistant can actually speak the way its persona claims to.
 *
 * This is prompt material, NOT knowledge-base content, and the distinction is
 * load-bearing. Retrieval answers "what does this company charge for
 * parking?" -- a lookup against documents that change. Vocabulary is not a
 * lookup; it is how the assistant talks, needed on every turn regardless of
 * what was asked. Putting it here means it is always available and costs
 * nothing after the first turn, because the instructions are the cached prefix.
 *
 * It lived in ./knowledge first, and retrieval was measurably bad at it: each
 * chunk held dozens of unrelated pairs, so its embedding averaged out to
 * something no single query matched strongly. "count to ten" retrieved the
 * adjectives file; bare lookups like "thank you" returned nothing at all.
 * That is not a tuning problem -- dense vector search is the wrong instrument
 * for exact-term lookup.
 *
 * Generated from the source files in ./vocabulary (241 pairs). Regenerate
 * rather than hand-editing, and keep it byte-stable: it sits inside the cached
 * prompt prefix, so an incidental change re-bills every session's instructions.
 */
export const VOCABULARY = `Greetings and Basic Phrases:
  Hello / Hi = Kumusta
  Good morning = Magandang umaga / Maayong buntag
  Good afternoon = Magandang hapon / Maayong hapon
  Good evening = Magandang gabi / Maayong gabii
  Goodbye = Paalam / Babay
  Good night = Magandang gabi / Maayong gabii
  See you = Kita tayo / Kita ta
  Thank you = Salamat
  Thanks a lot = Maraming salamat / Daghang salamat
  You're welcome = Walang anuman / Walay sapayan
  Please = Pakiusap / Palihog
  Sorry = Pasensya na / Pasayloa ko
  Excuse me = Makikiraan / Agian ko
  Yes = Oo
  No = Hindi / Dili
  Maybe = Siguro / Tingali
  Of course = Siyempre
  Really? = Talaga? / Tinood?
  That's right = Tama iyan / Mao kana

People and Pronouns:
  I / me = Ako
  You = Ikaw
  He / she = both "Siya / Siya
  We = Kami / Tayo / Kami / Kita
  They = Sila
  My = Aking / Akong
  Your = Iyong / Imong
  Our = Ating / Aming / Atong / Among
  Their = Kanilang / Ilang
  Friend = Kaibigan / Higala
  Family = Pamilya
  Mother = Nanay / Ina / Mama / Inahan
  Father = Tatay / Ama / Papa / Amahan
  Brother = Kapatid na lalaki / Igsoon nga lalaki
  Sister = Kapatid na babae / Igsoon nga babaye
  Child = Bata
  Man = Lalaki
  Woman = Babae / Babaye
  Person = Tao / Tawo

Questions and Conversation:
  What? = Ano? / Unsa?
  Who? = Sino? / Kinsa?
  Where? = Saan? / Asa?
  When? = Kailan? / Kanus-a?
  Why? = Bakit? / Ngano?
  How? = Paano? / Giunsa?
  How much? = Magkano? / Tagpila?
  How many? = Ilan? / Pila?
  Which? = Alin? / Asa?
  What is this? = Ano ito? / Unsa ni?
  What is that? = Ano iyon? / Unsa kana?
  Who is that? = Sino iyon? / Kinsa kana?
  Where are you? = Nasaan ka? / Asa ka?
  Where are you going? = Saan ka pupunta? / Asa ka paingon?
  What are you doing? = Ano ang ginagawa mo? / Unsa imong gibuhat?
  What happened? = Ano ang nangyari? / Unsa ang nahitabo?
  Are you okay? = Okay ka lang ba? / Okay ra ka?
  Do you understand? = Naiintindihan mo ba? / Kasabot ka?
  Do you know? = Alam mo ba? / Nahibalo ka?

Common Verbs:
  Eat = Kumain / Kaon
  Drink = Uminom / Inom
  Sleep = Matulog / Katulog
  Wake up = Gumising / Mata
  Go = Pumunta / Adto
  Come = Pumunta rito / Ari
  Walk = Maglakad / Lakad
  Run = Tumakbo / Dag-an
  Sit = Umupo / Lingkod
  Stand = Tumayo / Tindog
  Read = Magbasa
  Write = Sumulat / Sulat
  Speak = Magsalita / Sulti
  Talk = Makipag-usap / Makigstorya
  Listen = Makinig / Paminaw
  Learn = Matuto / Kat-on
  Teach = Magturo / Magtudlo
  Work = Magtrabaho / Trabaho
  Study = Mag-aral / Magtuon
  Help = Tumulong / Tabang
  Ask = Magtanong / Pangutana
  Answer = Sumagot / Tubag

Feelings and States:
  Happy = Masaya / Malipayon
  Sad = Malungkot / Masulob-on
  Angry = Galit / Nasuko
  Afraid = Takot / Nahadlok
  Excited = Nasasabik / Excited
  Tired = Pagod / Kapoy
  Hungry = Gutom / Gigutom
  Thirsty = Uhaw / Giuhaw
  Sleepy = Inaantok / Katulgon
  Sick = May sakit / Masakiton
  Fine = Mabuti / Ayos / Maayo / Okay
  Ready = Handa / Andam
  Busy = Abala / Busy
  Confused = Nalilito / Naglibog
  Worried = Nag-aalala / Nabalaka
  Bored = Nababagot / Nainip

Food and Household:
  Food = Pagkain / Pagkaon
  Water = Tubig
  Rice = Kanin / Kan-on
  Bread = Tinapay / Pan
  Meat = Karne
  Chicken = Manok
  Pork = Baboy
  Beef = Baka
  Fish = Isda
  Egg = Itlog
  Vegetable = Gulay
  Fruit = Prutas
  Salt = Asin
  Sugar = Asukal
  Coffee = Kape
  Milk = Gatas
  Breakfast = Almusal / Pamahaw
  Lunch = Tanghalian / Paniudto
  Dinner = Hapunan / Panihapon
  Kitchen = Kusina
  House = Bahay / Balay
  Room = Silid / Kwarto
  Bathroom = Banyo
  Door = Pinto / Pultahan
  Window = Bintana

Places and Transportation:
  School = Paaralan / Eskwelahan
  Office = Opisina
  Hospital = Ospital
  Store = Tindahan
  Market = Palengke / Merkado
  Restaurant = Restawran
  Church = Simbahan
  Bank = Bangko
  Airport = Paliparan
  Road = Kalsada / Dalan
  City = Lungsod / Dakbayan
  Town = Bayan / Bungto
  Beach = Dalampasigan / Baybayon
  River = Ilog / Suba
  Car = Kotse / Awto
  Bus = Bus
  Jeepney = Jeepney
  Tricycle = Traysikel / Traysikol
  Motorcycle = Motorsiklo
  Bicycle = Bisikleta
  Traffic = Trapiko
  Parking = Paradahan / Parkinganan
  Gas = Gasolina

Time and Numbers:
  Today = Ngayon / Karon
  Tomorrow = Bukas / Ugma
  Yesterday = Kahapon / Gahapon
  Now = Ngayon / Karon
  Later = Mamaya / Unya
  Morning = Umaga / Buntag
  Afternoon = Hapon
  Evening = Gabi / Gabii
  Night = Gabi / Gabii
  Day = Araw / Adlaw
  Week = Linggo / Semana
  Month = Buwan / Bulan
  Year = Taon / Tuig
  One = Isa / Usa
  Two = Dalawa / Duha
  Three = Tatlo / Tulo
  Four = Apat / Upat
  Five = Lima
  Six = Anim / Unom
  Seven = Pito
  Eight = Walo
  Nine = Siyam
  Ten = Sampu / Napulo

Descriptions and Qualities:
  Big = Malaki / Dako
  Small = Maliit / Gamay
  Long = Mahaba / Taas
  Short = Maikli / Mubo
  Hot = Mainit / Init
  Cold = Malamig / Bugnaw
  Fast = Mabilis / Paspas
  Slow = Mabagal / Hinay
  Good = Mabuti / Maayo
  Bad = Masama / Dili maayo
  Easy = Madali / Sayon
  Difficult = Mahirap / Lisod
  New = Bago / Bag-o
  Old = Luma / Da-an
  Clean = Malinis / Limpyo
  Dirty = Marumi / Hugaw
  Full = Puno
  Empty = Walang laman / Walay sulod
  Cheap = Mura / Barato
  Expensive = Mahal
  Important = Mahalaga / Importante
  Correct = Tama / Husto
  Wrong = Mali / Sayop

Everyday Conversation:
  I don't know = Hindi ko alam / Wala ko kahibalo
  I understand = Naiintindihan ko / Kasabot ko
  I don't understand = Hindi ko naiintindihan / Wala ko kasabot
  I need help = Kailangan ko ng tulong / Kinahanglan nako og tabang
  Help me = Tulungan mo ako / Tabangi ko
  Please wait = Mangyaring maghintay / Palihog hulat
  Please come here = Halika rito, pakiusap / Palihog ari diri
  Please sit down = Umupo ka, pakiusap / Palihog lingkod
  Speak slowly = Magsalita ka nang mabagal / Hinay-hinay pagsulti
  I am not sure = Hindi ako sigurado / Dili ko sigurado
  That's okay = Ayos lang iyan / Okay ra kana
  No problem = Walang problema / Walay problema
  Don't worry = Huwag kang mag-alala / Ayaw kabalaka
  I like it = Gusto ko ito / Ganahan ko niini
  I don't like it = Hindi ko ito gusto / Dili ko ganahan niini
  I love you = Mahal kita / Gihigugma tika
  I miss you = Miss kita / Gimingaw ko nimo

Useful Everyday Vocabulary:
  Money = Pera / Kwarta
  Price = Presyo
  Work = Trabaho
  Business = Negosyo
  Problem = Problema
  Question = Tanong / Pangutana
  Answer = Sagot / Tubag
  Information = Impormasyon
  Message = Mensahe
  Name = Pangalan / Ngalan
  Phone = Telepono
  Computer = Kompyuter
  Book = Libro
  Password = Password
  Internet = Internet
  Website = Website
  Email = Email
  Photo = Larawan / Litrato
  Video = Bidyo / Video
  Music = Musika
  Song = Kanta / Awit
  Movie = Pelikula / Salida
  News = Balita

Location and Direction:
  Left = Kaliwa / Wala
  Right = Kanan / Tuo
  Straight = Diretso / Tul-id
  Near = Malapit / Duol
  Far = Malayo / Layo
  Inside = Loob / Sulod
  Outside = Labas / Gawas
  Where is it? = Nasaan ito? / Asa kini?
  Where do you live? = Saan ka nakatira? / Asa ka nagpuyo?
  Where are you from? = Taga-saan ka? / Taga-asa ka?
  How much is this? = Magkano ito? / Tagpila ni?
  What time is it? = Anong oras na? / Unsa na orasa?`;
