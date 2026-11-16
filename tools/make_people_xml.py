# Writes kodi/skin-src/xml/Korie_People.xml (Settings › People): everyone on the left; four cards
# (each a heading and a list) the add-on places and sizes; a bar along the bottom. The rows repeat
# for each focus state, so they're written from here.  python3 tools/make_people_xml.py
import sys
from pathlib import Path
W = 516

def line(f, width):
    """A row. In the focused layout (f = the list's focus condition) the colours depend on f, as
    the selected row of a list without focus is drawn with the focused layout too."""
    def both(make):
        if f == "false":
            return make(False, "true")
        return make(True, f) + make(False, "!" + f)
    lw = width - 24 - 210 - 34
    return both(lambda on, vis: f'''
				<control type="group">
					<visible>{vis}</visible>
					<control type="image">
						<left>10</left><top>2</top><width>{width-20}</width><height>54</height>
						<texture border="10" colordiffuse="korie_accent">korie/r10.png</texture>
						<visible>{"true" if on else "false"}</visible>
					</control>
					<control type="label">
						<left>24</left><top>2</top><width>{lw}</width><height>54</height>
						<aligny>center</aligny><font>korie_body24</font>
						<textcolor>{"korie_onaccent" if on else "korie_ink90"}</textcolor>
						<label>$INFO[ListItem.Label]</label>
						<visible>!String.IsEqual(ListItem.Property(kind),note)</visible>
					</control>
					<control type="label">
						<left>24</left><top>2</top><width>{width-48}</width><height>54</height>
						<aligny>center</aligny><font>korie_body22</font>
						<textcolor>{"korie_onaccent" if on else "korie_dim"}</textcolor>
						<label>$INFO[ListItem.Label]</label>
						<visible>String.IsEqual(ListItem.Property(kind),note)</visible>
					</control>
					<control type="group">
						<visible>String.IsEqual(ListItem.Property(kind),sel)</visible>
						<control type="image">
							<right>24</right><top>8</top><width>210</width><height>42</height>
							<texture border="8" colordiffuse="{"korie_ground" if on else "korie_panel"}">korie/r10.png</texture>
						</control>
						<control type="label">
							<right>60</right><top>8</top><width>160</width><height>42</height>
							<aligny>center</aligny><font>korie_body22</font><textcolor>korie_ink</textcolor>
							<label>$INFO[ListItem.Label2]</label>
						</control>
						<control type="image">
							<right>34</right><top>19</top><width>20</width><height>20</height>
							<texture colordiffuse="korie_ink">korie/icon-chevron.png</texture>
						</control>
					</control>
					<control type="group">
						<visible>String.IsEqual(ListItem.Property(kind),tick)</visible>
						<control type="image">
							<right>28</right><top>11</top><width>36</width><height>36</height>
							<texture border="4" colordiffuse="korie_ink">korie/r10.png</texture>
							<visible>String.IsEmpty(ListItem.Property(on))</visible>
						</control>
						<control type="image">
							<right>28</right><top>11</top><width>36</width><height>36</height>
							<texture border="4" colordiffuse="{"korie_ground" if on else "korie_accent"}">korie/r10.png</texture>
							<visible>!String.IsEmpty(ListItem.Property(on))</visible>
						</control>
						<control type="image">
							<right>32</right><top>15</top><width>28</width><height>28</height>
							<texture>korie/icon-tickmark.png</texture>
							<visible>!String.IsEmpty(ListItem.Property(on))</visible>
						</control>
					</control>
				</control>''')


def card(cid, left):
    return f'''		<!-- a card: placed and sized by the add-on -->
		<control type="group" id="{cid + 1000}">
			<left>{left}</left><top>136</top>
			<control type="image" id="{cid + 2000}">
				<left>0</left><top>0</top><width>{W}</width><height>200</height>
				<texture border="12" colordiffuse="korie_panel2">korie/r12.png</texture>
			</control>
			<control type="label" id="{cid + 3000}">
				<left>24</left><top>8</top><width>{W-48}</width><height>48</height>
				<aligny>center</aligny><font>korie_heading26</font><textcolor>korie_ink90</textcolor>
				<label />
			</control>
			<control type="list" id="{cid}">
				<!-- as tall as it can get here: Kodi counts the rows that fit from this; the add-on shrinks it -->
				<left>0</left><top>56</top><width>{W}</width><height>{58 * 12}</height>
				<orientation>vertical</orientation>
				<scrolltime tween="quadratic">150</scrolltime>
				<itemlayout width="{W}" height="58">{line("false", W)}
				</itemlayout>
				<focusedlayout width="{W}" height="58">{line(f"Control.HasFocus({cid})", W)}
				</focusedlayout>
			</control>
		</control>'''

def person(f):
    if f != "false":
        return person_one(True, f) + person_one(False, "!" + f)
    return person_one(False, "true")


def person_one(on, vis):
    return f'''
				<control type="group">
				<visible>{vis}</visible>
				<control type="image">
					<left>0</left><top>0</top><width>320</width><height>88</height>
					<texture border="12" colordiffuse="korie_accent">korie/r12.png</texture>
					<visible>{"true" if on else "false"}</visible>
				</control>
				<control type="group">
					<visible>{"false" if on else "true"} + !String.IsEmpty(ListItem.Property(on))</visible>
					<control type="image">
						<left>0</left><top>0</top><width>320</width><height>88</height>
						<texture border="12" colordiffuse="korie_panel">korie/r12.png</texture>
					</control>
					<control type="image">
						<left>0</left><top>0</top><width>5</width><height>88</height>
						<texture border="2" colordiffuse="korie_accent">korie/r10.png</texture>
					</control>
				</control>
				<control type="image">
					<left>18</left><top>16</top><width>56</width><height>56</height>
					<texture border="10" colordiffuse="$INFO[ListItem.Property(colour)]">korie/r10.png</texture>
					<visible>String.IsEmpty(ListItem.Property(add))</visible>
				</control>
				<control type="label">
					<left>18</left><top>16</top><width>56</width><height>56</height>
					<align>center</align><aligny>center</aligny><font>korie_heading30</font><textcolor>korie_ground</textcolor>
					<label>$INFO[ListItem.Label2]</label>
					<visible>String.IsEmpty(ListItem.Property(add))</visible>
				</control>
				<control type="group">
					<visible>!String.IsEmpty(ListItem.Property(add))</visible>
					<control type="image">
						<left>18</left><top>16</top><width>56</width><height>56</height>
						<texture colordiffuse="{"korie_onaccent" if on else "korie_soft60"}">korie/dashed10.png</texture>
					</control>
					<control type="image">
						<left>32</left><top>30</top><width>28</width><height>28</height>
						<texture colordiffuse="{"korie_onaccent" if on else "korie_soft"}">korie/icon-plus.png</texture>
					</control>
				</control>
				<control type="label">
					<left>94</left><top>12</top><width>214</width><height>38</height>
					<aligny>center</aligny><font>korie_heading30</font>
					<textcolor>{"korie_onaccent" if on else "korie_ink"}</textcolor>
					<label>$INFO[ListItem.Label]</label>
				</control>
				<control type="label">
					<left>94</left><top>48</top><width>214</width><height>30</height>
					<aligny>center</aligny><font>korie_body22</font>
					<textcolor>{"korie_onaccent" if on else "korie_soft"}</textcolor>
					<label>$INFO[ListItem.Property(note)]</label>
				</control>
				</control>'''

xml = f'''<?xml version="1.0" encoding="UTF-8"?>
<!-- Korie: Settings › People (the People artboard). Everyone on the left (320); for the chosen
     person, cards in two columns (331 signing in, 332 add-ons; 341 films and series, 342 Android
     apps) and what else they may do along the bottom (351-354). The Korie add-on runs it
     (resources/lib/people.py): it fills the cards, sizes and places them, and joins them up.
     Written by tools/make_people_xml.py. -->
<window>
	<defaultcontrol always="true">320</defaultcontrol>
	<menucontrol>9000</menucontrol>
	<include content="KorieHere"><param name="id">settings</param><param name="n">7</param></include>
	<controls>
		<include>KorieBackground</include>
		<!-- no menu when it's opened from Who's watching (nobody is signed in) -->
		<control type="group">
			<visible>String.IsEmpty(Window.Property(korie.norail))</visible>
			<include content="KorieRail"><param name="right">320</param></include>
		</control>
		<control type="grouplist">
			<left>444</left><top>48</top><width>1000</width><height>64</height>
			<orientation>horizontal</orientation><itemgap>12</itemgap><usecontrolcoords>true</usecontrolcoords>
			<control type="label">
				<top>8</top><width>auto</width><height>64</height><aligny>center</aligny>
				<font>korie_body28</font><textcolor>korie_soft</textcolor><label>Settings ›</label>
			</control>
			<control type="label">
				<width>auto</width><height>64</height><aligny>center</aligny>
				<font>korie_heading46</font><textcolor>korie_ink</textcolor><label>People</label>
			</control>
		</control>
		<include content="KorieClock" />

		<control type="list" id="320">
			<left>444</left><top>136</top><width>320</width><height>900</height>
			<orientation>vertical</orientation>
			<onleft condition="String.IsEmpty(Window.Property(korie.norail))">$VAR[KorieToMenu]</onleft>
			<onright>331</onright>
			<onup>noop</onup><ondown>noop</ondown>
			<itemlayout width="320" height="92">{person("false")}
			</itemlayout>
			<focusedlayout width="320" height="92">{person("Control.HasFocus(320)")}
			</focusedlayout>
		</control>

{card(331, 804)}
{card(332, 804)}
{card(341, 1340)}
{card(342, 1340)}

		<!-- along the bottom: may install, change settings, delete (ticks: window properties the
		     add-on sets); name, colour and admin -->
		<control type="group" id="1350">
			<left>804</left><top>934</top>
			<control type="image">
				<left>0</left><top>0</top><width>1052</width><height>88</height>
				<texture border="12" colordiffuse="korie_panel2">korie/r12.png</texture>
			</control>
			<control type="button" id="351">
				<left>8</left><top>12</top><width>215</width><height>64</height>
				<texturefocus border="10" colordiffuse="korie_accent">korie/r10.png</texturefocus>
				<texturenofocus />
				<label />
				<onleft>noop</onleft><onright>352</onright><ondown>noop</ondown>
			</control>
			<control type="label">
				<left>70</left><top>12</top><width>147</width><height>64</height>
				<aligny>center</aligny><font>korie_body22</font><textcolor>korie_ink90</textcolor>
				<label>Install add-ons</label>
				<visible>Control.IsVisible(351) + !Control.HasFocus(351)</visible>
			</control>
			<control type="label">
				<left>70</left><top>12</top><width>147</width><height>64</height>
				<aligny>center</aligny><font>korie_body22</font><textcolor>korie_onaccent</textcolor>
				<label>Install add-ons</label>
				<visible>Control.HasFocus(351)</visible>
			</control>
			<control type="group">
				<left>20</left><top>26</top>
				<visible>Control.IsVisible(351)</visible>
				<control type="image">
					<width>36</width><height>36</height>
					<texture border="4" colordiffuse="korie_ink">korie/r10.png</texture>
					<visible>String.IsEmpty(Window.Property(korie.canInstall))</visible>
				</control>
				<control type="image">
					<width>36</width><height>36</height>
					<texture border="4" colordiffuse="korie_accent">korie/r10.png</texture>
					<visible>!String.IsEmpty(Window.Property(korie.canInstall)) + !Control.HasFocus(351)</visible>
				</control>
				<control type="image">
					<width>36</width><height>36</height>
					<texture border="4" colordiffuse="korie_ground">korie/r10.png</texture>
					<visible>!String.IsEmpty(Window.Property(korie.canInstall)) + Control.HasFocus(351)</visible>
				</control>
				<control type="image">
					<left>4</left><top>4</top><width>28</width><height>28</height>
					<texture>korie/icon-tickmark.png</texture>
					<visible>!String.IsEmpty(Window.Property(korie.canInstall))</visible>
				</control>
			</control>
			<control type="button" id="352">
				<left>231</left><top>12</top><width>229</width><height>64</height>
				<texturefocus border="10" colordiffuse="korie_accent">korie/r10.png</texturefocus>
				<texturenofocus />
				<label />
				<onleft>351</onleft><onright>353</onright><ondown>noop</ondown>
			</control>
			<control type="label">
				<left>293</left><top>12</top><width>161</width><height>64</height>
				<aligny>center</aligny><font>korie_body22</font><textcolor>korie_ink90</textcolor>
				<label>Change settings</label>
				<visible>Control.IsVisible(352) + !Control.HasFocus(352)</visible>
			</control>
			<control type="label">
				<left>293</left><top>12</top><width>161</width><height>64</height>
				<aligny>center</aligny><font>korie_body22</font><textcolor>korie_onaccent</textcolor>
				<label>Change settings</label>
				<visible>Control.HasFocus(352)</visible>
			</control>
			<control type="group">
				<left>243</left><top>26</top>
				<visible>Control.IsVisible(352)</visible>
				<control type="image">
					<width>36</width><height>36</height>
					<texture border="4" colordiffuse="korie_ink">korie/r10.png</texture>
					<visible>String.IsEmpty(Window.Property(korie.canSettings))</visible>
				</control>
				<control type="image">
					<width>36</width><height>36</height>
					<texture border="4" colordiffuse="korie_accent">korie/r10.png</texture>
					<visible>!String.IsEmpty(Window.Property(korie.canSettings)) + !Control.HasFocus(352)</visible>
				</control>
				<control type="image">
					<width>36</width><height>36</height>
					<texture border="4" colordiffuse="korie_ground">korie/r10.png</texture>
					<visible>!String.IsEmpty(Window.Property(korie.canSettings)) + Control.HasFocus(352)</visible>
				</control>
				<control type="image">
					<left>4</left><top>4</top><width>28</width><height>28</height>
					<texture>korie/icon-tickmark.png</texture>
					<visible>!String.IsEmpty(Window.Property(korie.canSettings))</visible>
				</control>
			</control>
			<control type="button" id="353">
				<left>468</left><top>12</top><width>288</width><height>64</height>
				<texturefocus border="10" colordiffuse="korie_accent">korie/r10.png</texturefocus>
				<texturenofocus />
				<label />
				<onleft>352</onleft><onright>354</onright><ondown>noop</ondown>
			</control>
			<control type="label">
				<left>530</left><top>12</top><width>220</width><height>64</height>
				<aligny>center</aligny><font>korie_body22</font><textcolor>korie_ink90</textcolor>
				<label>Delete from the library</label>
				<visible>Control.IsVisible(353) + !Control.HasFocus(353)</visible>
			</control>
			<control type="label">
				<left>530</left><top>12</top><width>220</width><height>64</height>
				<aligny>center</aligny><font>korie_body22</font><textcolor>korie_onaccent</textcolor>
				<label>Delete from the library</label>
				<visible>Control.HasFocus(353)</visible>
			</control>
			<control type="group">
				<left>480</left><top>26</top>
				<visible>Control.IsVisible(353)</visible>
				<control type="image">
					<width>36</width><height>36</height>
					<texture border="4" colordiffuse="korie_ink">korie/r10.png</texture>
					<visible>String.IsEmpty(Window.Property(korie.canDelete))</visible>
				</control>
				<control type="image">
					<width>36</width><height>36</height>
					<texture border="4" colordiffuse="korie_accent">korie/r10.png</texture>
					<visible>!String.IsEmpty(Window.Property(korie.canDelete)) + !Control.HasFocus(353)</visible>
				</control>
				<control type="image">
					<width>36</width><height>36</height>
					<texture border="4" colordiffuse="korie_ground">korie/r10.png</texture>
					<visible>!String.IsEmpty(Window.Property(korie.canDelete)) + Control.HasFocus(353)</visible>
				</control>
				<control type="image">
					<left>4</left><top>4</top><width>28</width><height>28</height>
					<texture>korie/icon-tickmark.png</texture>
					<visible>!String.IsEmpty(Window.Property(korie.canDelete))</visible>
				</control>
			</control>
			<control type="button" id="354">
				<left>764</left><top>12</top><width>241</width><height>64</height>
				<texturefocus border="10" colordiffuse="korie_accent">korie/r10.png</texturefocus>
				<texturenofocus />
				<label />
				<onleft>353</onleft><onright>noop</onright><ondown>noop</ondown>
			</control>
			<control type="label">
				<left>782</left><top>12</top><width>217</width><height>64</height>
				<aligny>center</aligny><font>korie_body22</font><textcolor>korie_ink90</textcolor>
				<label>Name, colour, admin…</label>
				<visible>Control.IsVisible(354) + !Control.HasFocus(354)</visible>
			</control>
			<control type="label">
				<left>782</left><top>12</top><width>217</width><height>64</height>
				<aligny>center</aligny><font>korie_body22</font><textcolor>korie_onaccent</textcolor>
				<label>Name, colour, admin…</label>
				<visible>Control.HasFocus(354)</visible>
			</control>
		</control>
	</controls>
</window>
'''
out = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent / "kodi" / "skin-src" / "xml" / "Korie_People.xml"
out.write_text(xml, encoding="utf-8")
