#pragma once

#include <JuceHeader.h>
#pragma once

#include "../JuceLibraryCode/JuceHeader.h"
#include "PianoRollEditorComponent.hpp"

//==============================================================================
/*
    This component lives inside our window, and this is where you should put all
    your controls and content.
*/
class MainComponent  : public juce::Component, public juce::Timer
{
public:
    //==============================================================================
    MainComponent();
    ~MainComponent() override;

    //==============================================================================
    void paint (juce::Graphics&) override;
    void resized() override;
    void timerCallback() ;

private:
    //==============================================================================
    // Your private member variables go here...
    st_int tickTest;
    PianoRollEditorComponent editor;
    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (MainComponent)
};
