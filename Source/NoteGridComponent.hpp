//
//  NoteGridComponent.hpp
//  PianoRollEditor - App
//
//  Created by Samuel Hunt on 16/08/2019.
//

#ifndef NoteGridComponent_hpp
#define NoteGridComponent_hpp

#include "PNoteComponent.hpp"
#include "NoteGridStyleSheet.hpp"

class SelectionBox : public Component {
public:
    void paint (Graphics & g)
    {
        Colour c = Colours::white;
        c = c.withAlpha((float)0.5);
        g.fillAll(c);
    }
    int startX, startY;
};

class NoteGridComponent :
public Component,
public KeyListener
{
public:
    

    NoteGridComponent (NoteGridStyleSheet & styleSheet);
    ~NoteGridComponent ();
    
    void paint (Graphics & g) override;
    void resized () override;
    
    void noteCompSelected (PNoteComponent *, const MouseEvent&);
    void noteCompPositionMoved (PNoteComponent *, bool callResize = true);
    void noteCompLengthChanged (PNoteComponent *, int diff);
    void noteCompDragging (PNoteComponent*, const MouseEvent&);
    void setPositions ();
    
    /* optional
    void mouseEnter (const MouseEvent&);
    void mouseExit  (const MouseEvent&);
    void mouseMove  (const MouseEvent&);
    */
    void mouseDown  (const MouseEvent&) override;
    void mouseDrag  (const MouseEvent&) override;
    void mouseUp    (const MouseEvent&) override;
    void mouseDoubleClick (const MouseEvent&) override;
    
    void setupGrid (float pixelsPerBar, float compHeight, const int bars);
    void setQuantisation (const int val);
    
    
    bool keyPressed (const KeyPress& key, Component* originatingComponent) override;
    void deleteAllSelected ();
    
    // From here you could convert this into MIDI or any other custom musical encoding.
    PRESequence getSequence ();
    void loadSequence (PRESequence sq);
    
    float getNoteCompHeight ();
    float getPixelsPerBar ();
    
    std::vector<NoteModel *> getSelectedModels ();
    
    std::function<void(int note,int velocity)> sendChange;
    std::function<void()> onEdit;
private:
    
    void sendEdit ();
    
    NoteGridStyleSheet & styleSheet;
    SelectionBox selectorBox;
    std::vector<PNoteComponent *> noteComps;
    
    Array<int> blackPitches;

    
    float noteCompHeight;
    float pixelsPerBar;
    st_int ticksPerTimeSignature;
    st_int currentQValue;
    st_int lastNoteLength;
    bool firstDrag;
    bool firstCall;
    int lastTrigger;
};
#endif /* NoteGridComponent_hpp */
